import type { ClientToServerEvents, ServerToClientEvents } from '@auction/shared';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from './api.ts';

let authToken: string | null = null;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(API_URL || undefined, {
  autoConnect: false,
  // Called on every (re)connect, so it always sends the latest token
  auth: (cb) => cb({ token: authToken }),
});

export const connection = $state({ connected: false });

socket.on('connect', () => (connection.connected = true));
socket.on('disconnect', () => (connection.connected = false));

/** Reconnects with the new token so the server knows who is bidding. */
export function setSocketToken(token: string | null) {
  authToken = token;
  if (socket.active) socket.disconnect().connect();
}
