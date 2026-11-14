import { SESSION_INVALID, type ClientToServerEvents, type Failure, type ServerToClientEvents } from '@auction/shared';
import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { config } from './config';
import { BidError, getAuctionDetail, placeBid } from './services/auctions';
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

const roomName = (auctionId: number) => `auction:${auctionId}`;
const sessionRoom = (sessionId: number) => `session:${sessionId}`;

const sessionFailure: Failure = { ok: false, error: 'Your session has expired. Please log in again.', code: SESSION_INVALID };

/** Downgrades a connection to guest: it leaves every room and is told its session ended. */
function endSession(socket: AppSocket) {
  socket.data.sessionId = undefined;
  for (const room of socket.rooms) {
    if (room !== socket.id) socket.leave(room);
  }
  socket.emit('session:expired');
}

/**
 * Every protected action calls this (RF02): the session is re-checked against the
 * database each time, so expiry and logout take effect immediately, and the use renews it.
 */
function requireSession(socket: AppSocket): Session | null {
  if (socket.data.sessionId === undefined) return null;
  const session = useSessionById(socket.data.sessionId);
  if (!session) endSession(socket);
  return session;
}

const isAuctionId = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;

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
    // Entering an auction room requires login (RF04)
    socket.on('room:join', (auctionId, ack) => {
      if (typeof ack !== 'function') return;
      if (!requireSession(socket)) return ack(sessionFailure);
      if (!isAuctionId(auctionId)) return ack({ ok: false, error: 'Invalid auction' });

      const auction = getAuctionDetail(auctionId);
      if (!auction) return ack({ ok: false, error: 'Auction not found' });

      socket.join(roomName(auctionId));
      ack({ ok: true, auction });
    });

    socket.on('room:leave', (auctionId) => {
      if (isAuctionId(auctionId)) socket.leave(roomName(auctionId));
    });

    socket.on('bid:place', (payload, ack) => {
      if (typeof ack !== 'function') return;

      const session = requireSession(socket);
      if (!session) return ack(sessionFailure);

      const { auctionId, amount } = payload ?? {};
      if (!isAuctionId(auctionId) || !Number.isInteger(amount) || amount <= 0) {
        return ack({ ok: false, error: 'Invalid bid' });
      }
      if (!socket.rooms.has(roomName(auctionId))) {
        return ack({ ok: false, error: 'Enter the auction room to bid' });
      }

      try {
        const result = placeBid(auctionId, session.user, amount);
        // Listings are public, but who bid is only shared with the room
        io.emit('auction:updated', result.auction);
        io.to(roomName(auctionId)).emit('room:bid', result);
        ack({ ok: true });
      } catch (err) {
        if (err instanceof BidError) return ack({ ok: false, error: err.message });
        app.log.error(err, 'Failed to place bid');
        ack({ ok: false, error: 'Something went wrong, please try again' });
      }
    });
  });

  // Sessions can expire while a connection sits idle in a room; remove them from it
  const sweep = setInterval(() => {
    deleteExpiredSessions();
    for (const socket of io.of('/').sockets.values()) {
      const { sessionId } = socket.data;
      if (sessionId !== undefined && !isSessionActive(sessionId)) endSession(socket);
    }
  }, SWEEP_INTERVAL_MS);

  app.decorate('io', io);
  app.decorate('endSocketSession', (sessionId: number) => {
    for (const socket of io.of('/').sockets.values()) {
      if (socket.data.sessionId === sessionId) endSession(socket);
    }
  });

  app.addHook('preClose', async () => {
    clearInterval(sweep);
    io.local.disconnectSockets(true);
  });
}
