import { createHash, randomBytes } from 'node:crypto';
import { SESSION_INVALID } from '@auction/shared';
import { config } from '../config';
import { AppError } from '../errors';
import { transaction } from '../persistence';
import { nextId, store, type SessionRecord } from '../store';

export interface Session {
  id: number;
  user: { id: number; name: string };
}

// Renewals happen on every request; only write them to disk when they move the expiry noticeably
const PERSIST_RENEWAL_MS = Math.min(60 * 1000, config.session.idleTimeoutMs / 10);

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const sessionExpired = () => new AppError(401, 'Sua sessão expirou. Entre novamente.', { code: SESSION_INVALID });

export const isExpired = (session: SessionRecord, now = Date.now()) => now >= session.expiresAt;

/** Starts a session and returns the opaque token the client must send back. */
export function createSession(userId: number): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const session: SessionRecord = {
    id: nextId('session'),
    userId,
    tokenHash: hashToken(token),
    createdAt: now,
    expiresAt: now + config.session.idleTimeoutMs,
    absoluteExpiresAt: now + config.session.maxLifetimeMs,
  };
  transaction(() => {
    store.sessions.set(session.id, session);
    store.sessionIdsByTokenHash.set(session.tokenHash, session.id);
  });
  return token;
}

/**
 * Checks a session (by token or id) and, because it is being used, extends its idle timeout.
 * Returns null once it has expired; the sweep (jobs.ts) removes it and ends its connections.
 */
export function useSession(by: { token: string } | { id: number }): Session | null {
  const id = 'id' in by ? by.id : store.sessionIdsByTokenHash.get(hashToken(by.token));
  const session = id === undefined ? undefined : store.sessions.get(id);
  if (!session || isExpired(session)) return null;

  const renewed = Math.min(Date.now() + config.session.idleTimeoutMs, session.absoluteExpiresAt);
  if (renewed - session.expiresAt > PERSIST_RENEWAL_MS) transaction(() => (session.expiresAt = renewed));
  else session.expiresAt = renewed;

  const user = store.users.get(session.userId)!;
  return { id: session.id, user: { id: user.id, name: user.name } };
}

/** Ends the sessions that match and returns their ids (logout, password change, deleted account, expiry). */
export function deleteSessions(match: (session: SessionRecord) => boolean): number[] {
  const ended = [...store.sessions.values()].filter(match);
  if (ended.length) {
    transaction(() => {
      for (const session of ended) {
        store.sessions.delete(session.id);
        store.sessionIdsByTokenHash.delete(session.tokenHash);
      }
    });
  }
  return ended.map((session) => session.id);
}
