import type { ClientToServerEvents, ServerToClientEvents } from '@auction/shared';
import { io, type Socket } from 'socket.io-client';
import { API_URL, authToken } from './api.ts';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(API_URL || undefined, {
  autoConnect: false,
  // Called on every (re)connect, so it always sends the latest token
  auth: (cb) => cb({ token: authToken() }),
});

export const connection = $state({ connected: false });

socket.on('connect', () => (connection.connected = true));
socket.on('disconnect', () => (connection.connected = false));

/** Subscribes to a socket event and returns the unsubscribe function (e.g. for an $effect to return). */
export function listen<E extends keyof ServerToClientEvents | 'connect'>(
  event: E,
  handler: E extends keyof ServerToClientEvents ? ServerToClientEvents[E] : () => void,
): () => void {
  socket.on(event, handler as never);
  return () => socket.off(event, handler as never);
}

/** Reconnects with the current token, so the server knows who is bidding. */
export function reconnectSocket() {
  if (socket.active) socket.disconnect().connect();
}
