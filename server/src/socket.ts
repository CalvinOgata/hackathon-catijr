import { IDEMPOTENCY_KEY_MAX_LENGTH, SESSION_INVALID, type BidFailure, type ClientToServerEvents, type Failure, type RoomMode, type RoomPresence, type ServerToClientEvents } from '@auction/shared';
import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { config } from './config';
import { BidError, bidderTag, getAuction, getAuctionDetail, placeBid } from './services/auctions';
import { deleteExpiredSessions, isSessionActive, useSessionById, useSessionByToken, type Session } from './services/sessions';

interface SocketData {
  sessionId?: number;
  /** The session's user, kept to count people (not connections) in rooms. */
  userId?: number;
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

// RF25: each auction has two rooms. A connection is in at most one of them: participants can
// bid, spectators only watch. Both receive the bids and the headcount.
const roomName = (auctionId: number) => `auction:${auctionId}`;
const spectatorRoom = (auctionId: number) => `auction:${auctionId}:spectators`;
const sessionRoom = (sessionId: number) => `session:${sessionId}`;

/** The auction ids of the rooms (either kind) a connection is in. */
function auctionIdsOf(socket: AppSocket): number[] {
  const ids: number[] = [];
  for (const room of socket.rooms) {
    const match = room.match(/^auction:(\d+)(:spectators)?$/);
    if (match) ids.push(Number(match[1]));
  }
  return ids;
}

/** The users connected to a room (several tabs of one user count once). */
function usersIn(io: IO, room: string): Set<number> {
  const users = new Set<number>();
  for (const socketId of io.sockets.adapter.rooms.get(room) ?? []) {
    const userId = io.sockets.sockets.get(socketId)?.data.userId;
    if (userId !== undefined) users.add(userId);
  }
  return users;
}

/** Sends the headcount to everyone in the auction's rooms (RF25). */
function broadcastPresence(io: IO, auctionId: number) {
  const participants = usersIn(io, roomName(auctionId));
  const spectators = usersIn(io, spectatorRoom(auctionId));
  // Someone watching in one tab and bidding in another is a participant
  for (const userId of participants) spectators.delete(userId);
  const presence: RoomPresence = { auctionId, participants: participants.size, spectators: spectators.size };
  io.to(roomName(auctionId)).to(spectatorRoom(auctionId)).emit('room:presence', presence);
}

const sessionFailure: Failure = { ok: false, error: 'Sua sessão expirou. Entre novamente.', code: SESSION_INVALID };

/** Downgrades a connection to guest: it leaves every room and is told its session ended. */
function endSession(io: IO, socket: AppSocket) {
  const auctionIds = auctionIdsOf(socket);
  socket.data.sessionId = undefined;
  socket.data.userId = undefined;
  for (const room of socket.rooms) {
    if (room !== socket.id) socket.leave(room);
  }
  socket.emit('session:expired');
  for (const auctionId of auctionIds) broadcastPresence(io, auctionId);
}

/**
 * Every protected action calls this (RF02): the session is re-checked against the
 * database each time, so expiry and logout take effect immediately, and the use renews it.
 */
function requireSession(io: IO, socket: AppSocket): Session | null {
  if (socket.data.sessionId === undefined) return null;
  const session = useSessionById(socket.data.sessionId);
  if (!session) endSession(io, socket);
  return session;
}

const isAuctionId = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;

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
      socket.data.userId = session.user.id;
      socket.join(sessionRoom(session.id));
    }
    next();
  });

  io.on('connection', (socket) => {
    // The server's clock is the one that counts (RF16); browsers use this to correct theirs
    socket.on('clock:sync', (ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });

    // Entering an auction room requires login (RF04), as a participant or a spectator (RF25).
    // Joining again (e.g. after reconnecting) moves the connection to the room of the new mode.
    socket.on('room:join', (auctionId, mode, ack) => {
      if (typeof ack !== 'function') return;
      const session = requireSession(io, socket);
      if (!session) return ack(sessionFailure);
      if (!isAuctionId(auctionId)) return ack({ ok: false, error: 'Leilão inválido' });

      const auction = getAuctionDetail(auctionId);
      if (!auction) return ack({ ok: false, error: 'Leilão não encontrado' });

      // The seller can only watch their own auction (RF04, RF25)
      const resolvedMode: RoomMode = mode === 'participant' && auction.sellerId !== session.user.id ? 'participant' : 'spectator';
      socket.leave(resolvedMode === 'participant' ? spectatorRoom(auctionId) : roomName(auctionId));
      socket.join(resolvedMode === 'participant' ? roomName(auctionId) : spectatorRoom(auctionId));

      broadcastPresence(io, auctionId);
      ack({ ok: true, auction, mode: resolvedMode, viewerTag: bidderTag(auctionId, session.user.id) });
    });

    // RF25: a spectator becomes a participant without leaving the room
    socket.on('room:upgrade', (auctionId, ack) => {
      if (typeof ack !== 'function') return;
      const session = requireSession(io, socket);
      if (!session) return ack(sessionFailure);
      if (!isAuctionId(auctionId)) return ack({ ok: false, error: 'Leilão inválido' });

      const auction = getAuctionDetail(auctionId);
      if (!auction) return ack({ ok: false, error: 'Leilão não encontrado' });
      if (auction.sellerId === session.user.id) {
        return ack({ ok: false, error: 'Você não pode participar do próprio leilão, só assistir' });
      }
      if (!socket.rooms.has(spectatorRoom(auctionId)) && !socket.rooms.has(roomName(auctionId))) {
        return ack({ ok: false, error: 'Entre na sala do leilão primeiro' });
      }

      socket.leave(spectatorRoom(auctionId));
      socket.join(roomName(auctionId));

      broadcastPresence(io, auctionId);
      ack({ ok: true, auction, mode: 'participant', viewerTag: bidderTag(auctionId, session.user.id) });
    });

    socket.on('room:leave', (auctionId) => {
      if (!isAuctionId(auctionId)) return;
      socket.leave(roomName(auctionId));
      socket.leave(spectatorRoom(auctionId));
      broadcastPresence(io, auctionId);
    });

    // A closed tab or a dropped connection leaves its rooms too: update their headcount
    socket.on('disconnecting', () => {
      const auctionIds = auctionIdsOf(socket);
      socket.once('disconnect', () => {
        for (const auctionId of auctionIds) broadcastPresence(io, auctionId);
      });
    });

    socket.on('bid:place', (payload, ack) => {
      if (typeof ack !== 'function') return;

      const { auctionId, amount, idempotencyKey } = payload ?? {};
      // RF10: every refusal tells the reason and the current minimum (when the auction exists)
      const refuse = (failure: Omit<BidFailure, 'ok' | 'currentMinBid'>) =>
        ack({ ok: false, ...failure, currentMinBid: (isAuctionId(auctionId) && getAuction(auctionId)?.minBid) || undefined });

      const session = requireSession(io, socket);
      if (!session) return refuse(sessionFailure);

      if (!isAuctionId(auctionId) || !Number.isInteger(amount) || amount <= 0) {
        return refuse({ error: 'Lance inválido', code: 'INVALID_BID' });
      }
      if (idempotencyKey !== undefined && !isIdempotencyKey(idempotencyKey)) {
        return refuse({ error: 'Lance inválido', code: 'INVALID_BID' });
      }
      // Only participants bid (RF10, RF25)
      if (!socket.rooms.has(roomName(auctionId))) {
        const watching = socket.rooms.has(spectatorRoom(auctionId));
        return refuse({
          error: watching ? 'Você está assistindo como espectador. Participe do leilão para dar lances' : 'Entre na sala do leilão para dar lances',
          code: 'NOT_IN_ROOM',
        });
      }

      try {
        const result = placeBid(auctionId, session.user, amount, idempotencyKey);
        // Listings are public, but who bid is only shared with the room, spectators included (RF09, RF11, RF25).
        // A re-sent bid (RF12) changed nothing, so there's nothing to announce.
        if (!result.isReplay) {
          io.emit('auction:updated', result.auction);
          io.to(roomName(auctionId)).to(spectatorRoom(auctionId)).emit('room:bid', { auction: result.auction, bid: result.bid });
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
      if (sessionId !== undefined && !isSessionActive(sessionId)) endSession(io, socket);
    }
  }, SWEEP_INTERVAL_MS);

  app.decorate('io', io);
  app.decorate('endSocketSession', (sessionId: number) => {
    for (const socket of io.of('/').sockets.values()) {
      if (socket.data.sessionId === sessionId) endSession(io, socket);
    }
  });

  app.addHook('preClose', async () => {
    clearInterval(sweep);
    io.local.disconnectSockets(true);
  });
}
