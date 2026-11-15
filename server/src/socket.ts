import { IDEMPOTENCY_KEY_MAX_LENGTH, type ClientToServerEvents, type Failure, type RoomMode, type ServerToClientEvents } from '@auction/shared';
import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { config } from './config';
import { AppError } from './errors';
import { bidderTag, getAuction, getAuctionDetail, placeBid } from './services/auctions';
import { deleteSessions, sessionExpired, useSession, type Session } from './services/sessions';
import type { SessionRecord } from './store';

interface SocketData {
  sessionId?: number;
  /** The session's user, kept to count people (not connections) in rooms. */
  userId?: number;
  /** RF25: the auction rooms this connection is in, and its role in each. */
  rooms: Map<number, RoomMode>;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

declare module 'fastify' {
  interface FastifyInstance {
    io: IO;
    /** Ends the matching sessions (logout, password change, deleted account, expiry) and takes their connections out of every room. */
    endSessions: (match: (session: SessionRecord) => boolean) => void;
  }
}

const roomName = (auctionId: number) => `auction:${auctionId}`;
const sessionRoom = (sessionId: number) => `session:${sessionId}`;

const isAuctionId = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;

const isIdempotencyKey = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= IDEMPOTENCY_KEY_MAX_LENGTH;

export function registerSocket(app: FastifyInstance) {
  const io: IO = new Server(app.server, { cors: { origin: config.corsOrigin } });

  /** Sends the headcount to everyone in the auction's room (RF25). Several tabs of one user count once. */
  function broadcastPresence(auctionId: number) {
    const participants = new Set<number>();
    const spectators = new Set<number>();
    for (const socketId of io.sockets.adapter.rooms.get(roomName(auctionId)) ?? []) {
      const { userId, rooms } = io.sockets.sockets.get(socketId)!.data;
      if (userId !== undefined) (rooms.get(auctionId) === 'participant' ? participants : spectators).add(userId);
    }
    // Someone watching in one tab and bidding in another is a participant
    for (const userId of participants) spectators.delete(userId);
    io.to(roomName(auctionId)).emit('room:presence', { auctionId, participants: participants.size, spectators: spectators.size });
  }

  function leaveRoom(socket: AppSocket, auctionId: number) {
    socket.leave(roomName(auctionId));
    socket.data.rooms.delete(auctionId);
    broadcastPresence(auctionId);
  }

  /** Downgrades a connection to guest: it leaves every room and is told its session ended. */
  function endSession(socket: AppSocket) {
    if (socket.data.sessionId !== undefined) socket.leave(sessionRoom(socket.data.sessionId));
    socket.data.sessionId = socket.data.userId = undefined;
    for (const auctionId of [...socket.data.rooms.keys()]) leaveRoom(socket, auctionId);
    socket.emit('session:expired');
  }

  /**
   * Every protected event calls this (RF02): the session is re-checked each time, so expiry and
   * logout take effect immediately, and the use renews it.
   */
  function requireSession(socket: AppSocket): Session {
    const { sessionId } = socket.data;
    const session = sessionId === undefined ? null : useSession({ id: sessionId });
    if (!session) {
      if (sessionId !== undefined) endSession(socket);
      throw sessionExpired();
    }
    return session;
  }

  /**
   * Answers an event with what `work` returns, or with why it was refused: an AppError's message
   * and details, plus `failureDetails` (e.g. the current minimum bid, RF10). Unexpected errors are
   * logged and answered with a generic message.
   */
  function respond<T>(ack: ((result: T | Failure) => void) | undefined, work: () => T, failureDetails = () => ({})) {
    if (typeof ack !== 'function') return;
    let result: T | Failure;
    try {
      result = work();
    } catch (err) {
      const known = err instanceof AppError;
      if (!known) app.log.error(err, 'Socket event failed');
      result = { ok: false, error: known ? err.message : 'Algo deu errado. Tente novamente.', ...failureDetails(), ...(known ? err.extra : {}) };
    }
    ack(result);
  }

  // Anyone can connect to follow public listing updates; rooms and bids need a session.
  io.use((socket, next) => {
    socket.data.rooms = new Map();
    const token: unknown = socket.handshake.auth?.token;
    const session = typeof token === 'string' && token ? useSession({ token }) : null;
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
    // Joining again changes the role without leaving the room (e.g. a spectator starts bidding).
    socket.on('room:join', (auctionId, mode, ack) =>
      respond(ack, () => {
        const session = requireSession(socket);
        const auction = isAuctionId(auctionId) ? getAuctionDetail(auctionId) : undefined;
        if (!auction) throw new AppError(404, 'Leilão não encontrado');

        // The seller can only watch their own auction (RF04, RF25)
        const role: RoomMode = mode === 'participant' && auction.sellerId !== session.user.id ? 'participant' : 'spectator';
        socket.join(roomName(auction.id));
        socket.data.rooms.set(auction.id, role);
        broadcastPresence(auction.id);
        return { ok: true as const, auction, mode: role, viewerTag: bidderTag(auction.id, session.user.id) };
      }),
    );

    socket.on('room:leave', (auctionId) => {
      if (socket.data.rooms.has(auctionId)) leaveRoom(socket, auctionId);
    });

    // A closed tab or a dropped connection has left its rooms: update their headcount
    socket.on('disconnect', () => {
      for (const auctionId of socket.data.rooms.keys()) broadcastPresence(auctionId);
    });

    socket.on('bid:place', (payload, ack) => {
      const { auctionId, amount, idempotencyKey } = payload ?? {};
      respond(
        ack,
        () => {
          const session = requireSession(socket);
          const validKey = idempotencyKey === undefined || isIdempotencyKey(idempotencyKey);
          if (!isAuctionId(auctionId) || !Number.isInteger(amount) || amount <= 0 || !validKey) {
            throw new AppError(400, 'Lance inválido', { code: 'INVALID_BID' });
          }
          // Only participants bid (RF10, RF25)
          const role = socket.data.rooms.get(auctionId);
          if (role !== 'participant') {
            const reason = role ? 'Você está assistindo como espectador. Participe do leilão para dar lances' : 'Entre na sala do leilão para dar lances';
            throw new AppError(403, reason, { code: 'NOT_IN_ROOM' });
          }

          const { auction, bid, isReplay } = placeBid(auctionId, session.user, amount, idempotencyKey);
          // Listings are public, but who bid is only shared with the room, spectators included (RF09, RF11, RF25).
          // A re-sent bid (RF12) changed nothing, so there's nothing to announce.
          if (!isReplay) {
            io.emit('auction:updated', auction);
            io.to(roomName(auctionId)).emit('room:bid', { auction, bid });
          }
          return { ok: true as const, auction, bid };
        },
        // RF10: every refusal tells the current minimum (when the auction exists)
        () => ({ currentMinBid: isAuctionId(auctionId) ? getAuction(auctionId)?.minBid : undefined }),
      );
    });
  });

  app.decorate('io', io);
  app.decorate('endSessions', (match: (session: SessionRecord) => boolean) => {
    for (const sessionId of deleteSessions(match)) {
      for (const socketId of [...(io.sockets.adapter.rooms.get(sessionRoom(sessionId)) ?? [])]) {
        endSession(io.sockets.sockets.get(socketId)!);
      }
    }
  });

  app.addHook('preClose', async () => {
    io.local.disconnectSockets(true);
  });
}
