import { minNextBid, SESSION_INVALID, type ClientToServerEvents, type Failure, type RoomMode, type ServerToClientEvents } from '@auction/shared';
import { IDEMPOTENCY_KEY_MAX_LENGTH, SESSION_INVALID, type BidFailure, type ClientToServerEvents, type Failure, type ServerToClientEvents } from '@auction/shared';
import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { config } from './config';
import { BidError, bidderTag, getAuction, getAuctionDetail, placeBid } from './services/auctions';
import { deleteExpiredSessions, isSessionActive, useSessionById, useSessionByToken, type Session } from './services/sessions';

interface SocketData {
  sessionId?: number;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

declare module 'fastify' {
  interface FastifyInstance {
    io: IO;
    /** Removes every connection of a session from its rooms (used on logout). */
    endSocketSession: (sessionId: number) => void;
  }
}

const SWEEP_INTERVAL_MS = 60 * 1000;

/** Main participant room: guards bid placement. */
const roomName = (auctionId: number) => `auction:${auctionId}`;
/** Spectator room: receives bids and presence, but cannot place bids. */
const spectatorRoom = (auctionId: number) => `auction:${auctionId}:spectators`;
const sessionRoom = (sessionId: number) => `session:${sessionId}`;

const sessionFailure: Failure = { ok: false, error: 'Sua sessão expirou. Entre novamente.', code: SESSION_INVALID };

/** Downgrades a connection to guest: it leaves every room and is told its session ended. */
function endSession(socket: AppSocket, io: IO) {
  // Collect auction IDs the socket was in so we can broadcast updated presence after leaving
  const auctionIds = new Set<number>();
  for (const room of socket.rooms) {
    const participantMatch = room.match(/^auction:(\d+)$/);
    const spectatorMatch = room.match(/^auction:(\d+):spectators$/);
    if (participantMatch) auctionIds.add(Number(participantMatch[1]));
    if (spectatorMatch) auctionIds.add(Number(spectatorMatch[1]));
    if (room !== socket.id) socket.leave(room);
  }
  socket.data.sessionId = undefined;
  socket.emit('session:expired');
  for (const auctionId of auctionIds) broadcastPresence(io, auctionId);
}

/**
 * Every protected action calls this (RF02): the session is re-checked against the
 * database each time, so expiry and logout take effect immediately, and the use renews it.
 * Returns null (without calling endSession) so callers can respond with sessionFailure first.
 */
function requireSession(socket: AppSocket): Session | null {
  if (socket.data.sessionId === undefined) return null;
  const session = useSessionById(socket.data.sessionId);
  if (!session) return null; // caller must call endSession(socket, io) to clean up rooms
  return session;
}

const isAuctionId = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;

/** Counts participants and spectators for an auction room. */
function roomPresenceCounts(io: IO, auctionId: number): { participants: number; spectators: number } {
  const participants = io.sockets.adapter.rooms.get(roomName(auctionId))?.size ?? 0;
  const spectators = io.sockets.adapter.rooms.get(spectatorRoom(auctionId))?.size ?? 0;
  return { participants, spectators };
}

/** Broadcasts current headcount to everyone in the auction's rooms (RF25). */
function broadcastPresence(io: IO, auctionId: number) {
  const { participants, spectators } = roomPresenceCounts(io, auctionId);
  const payload = { auctionId, participants, spectators };
  // Emit to both rooms (participants room + spectators room)
  io.to(roomName(auctionId)).to(spectatorRoom(auctionId)).emit('room:presence', payload);
}
const isIdempotencyKey = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= IDEMPOTENCY_KEY_MAX_LENGTH;

export function registerSocket(app: FastifyInstance) {
  const io: IO = new Server(app.server, { cors: { origin: config.corsOrigin } });

  // Anyone can connect to follow public listing updates; rooms and bids need a session.
  io.use((socket, next) => {
    const token: unknown = socket.handshake.auth?.token;
    const session = typeof token === 'string' && token ? useSessionByToken(token) : null;
    if (session) {
      socket.data.sessionId = session.id;
      socket.join(sessionRoom(session.id));
    }
    next();
  });

  io.on('connection', (socket) => {
    // RF04 / RF25: entering an auction room requires login; mode selects participant or spectator.
    socket.on('room:join', (auctionId, mode, ack) => {
      if (typeof ack !== 'function') return;
      const session = requireSession(socket);
      if (!session) {
        endSession(socket, io);
        return ack(sessionFailure);
      }
    // The server's clock is the one that counts (RF16); browsers use this to correct theirs
    socket.on('clock:sync', (ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });

    // Entering an auction room requires login (RF04)
    socket.on('room:join', (auctionId, ack) => {
      if (typeof ack !== 'function') return;
      const session = requireSession(socket);
      if (!session) return ack(sessionFailure);
      if (!isAuctionId(auctionId)) return ack({ ok: false, error: 'Leilão inválido' });

      const auction = getAuctionDetail(auctionId);
      if (!auction) return ack({ ok: false, error: 'Leilão não encontrado' });

      // Validate mode; default to spectator for unknown values
      const resolvedMode: RoomMode = mode === 'participant' ? 'participant' : 'spectator';

      if (resolvedMode === 'participant') {
        socket.join(roomName(auctionId));
      } else {
        socket.join(spectatorRoom(auctionId));
      }

      broadcastPresence(io, auctionId);
      ack({ ok: true, auction, mode: resolvedMode });
    });

    // RF25: promote a spectator to participant without disconnecting.
    socket.on('room:upgrade', (auctionId, ack) => {
      if (typeof ack !== 'function') return;
      const session = requireSession(socket);
      if (!session) {
        endSession(socket, io);
        return ack(sessionFailure);
      }
      if (!isAuctionId(auctionId)) return ack({ ok: false, error: 'Leilão inválido' });

      const auction = getAuctionDetail(auctionId);
      if (!auction) return ack({ ok: false, error: 'Leilão não encontrado' });

      // Leave spectator room and join participant room
      socket.leave(spectatorRoom(auctionId));
      socket.join(roomName(auctionId));

      broadcastPresence(io, auctionId);
      ack({ ok: true, auction, mode: 'participant' });
      ack({ ok: true, auction, viewerTag: bidderTag(auctionId, session.user.id) });
    });

    // RF25: on explicit leave, clean up both rooms (participant and spectator) and update presence.
    socket.on('room:leave', (auctionId) => {
      if (!isAuctionId(auctionId)) return;
      socket.leave(roomName(auctionId));
      socket.leave(spectatorRoom(auctionId));
      broadcastPresence(io, auctionId);
    });

    socket.on('bid:place', (payload, ack) => {
      if (typeof ack !== 'function') return;

      const { auctionId, amount, idempotencyKey } = payload ?? {};
      // RF10: every refusal tells the reason and the current minimum (when the auction exists)
      const refuse = (failure: Omit<BidFailure, 'ok' | 'currentMinBid'>) =>
        ack({ ok: false, ...failure, currentMinBid: (isAuctionId(auctionId) && getAuction(auctionId)?.minBid) || undefined });

      const session = requireSession(socket);
      if (!session) {
        endSession(socket, io);
        return ack(sessionFailure);
      }
      if (!session) return refuse(sessionFailure);

      if (!isAuctionId(auctionId) || !Number.isInteger(amount) || amount <= 0) {
        return refuse({ error: 'Lance inválido', code: 'INVALID_BID' });
      }
      if (idempotencyKey !== undefined && !isIdempotencyKey(idempotencyKey)) {
        return refuse({ error: 'Lance inválido', code: 'INVALID_BID' });
      }
      if (!socket.rooms.has(roomName(auctionId))) {
        return refuse({ error: 'Entre na sala do leilão para dar lances', code: 'NOT_IN_ROOM' });
      }

      try {
        const result = placeBid(auctionId, session.user, amount, idempotencyKey);
        // Listings are public, but who bid is only shared with the room (RF09, RF11).
        // A re-sent bid (RF12) changed nothing, so there's nothing to announce.
        if (!result.isReplay) {
          io.emit('auction:updated', result.auction);
          // Broadcast bids to both participant and spectator rooms
          io.to(roomName(auctionId)).to(spectatorRoom(auctionId)).emit('room:bid', result);
          io.to(roomName(auctionId)).emit('room:bid', { auction: result.auction, bid: result.bid });
        }
        ack({ ok: true, auction: result.auction, bid: result.bid });
      } catch (err) {
        if (err instanceof BidError) {
          return ack({
            ok: false,
            error: err.message,
            code: err.code,
            currentMinBid: err.currentMinBid,
          });
        }
        app.log.error(err, 'Failed to place bid');
        refuse({ error: 'Algo deu errado. Tente novamente.' });
      }
    });
  });

  // Sessions can expire while a connection sits idle in a room; remove them from it
  const sweep = setInterval(() => {
    deleteExpiredSessions();
    for (const socket of io.of('/').sockets.values()) {
      const { sessionId } = socket.data;
      if (sessionId !== undefined && !isSessionActive(sessionId)) endSession(socket, io);
    }
  }, SWEEP_INTERVAL_MS);

  app.decorate('io', io);
  app.decorate('endSocketSession', (sessionId: number) => {
    for (const socket of io.of('/').sockets.values()) {
      if (socket.data.sessionId === sessionId) endSession(socket, io);
    }
  });

  app.addHook('preClose', async () => {
    clearInterval(sweep);
    io.local.disconnectSockets(true);
  });
}
