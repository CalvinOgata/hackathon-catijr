import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config';
import { saveStore } from '../persistence';
import { nextId, store, type SessionRecord } from '../store';

export interface Session {
  id: number;
  user: { id: number; name: string };
}

// Renewals happen on every request; only write them to disk when they move the expiry noticeably
const PERSIST_RENEWAL_MS = Math.min(60 * 1000, config.session.idleTimeoutMs / 10);

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

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
  store.sessions.set(session.id, session);
  store.sessionIdsByTokenHash.set(session.tokenHash, session.id);
  saveStore();
  return token;
}

/**
 * Checks a session and, because it is being used, extends its idle timeout.
 * Returns null (and forgets the session) once it has expired.
 */
function use(session: SessionRecord | undefined): Session | null {
  if (!session) return null;

  const now = Date.now();
  if (now >= session.expiresAt) {
    deleteSession(session.id);
    return null;
  }

  const renewed = Math.min(now + config.session.idleTimeoutMs, session.absoluteExpiresAt);
  const persist = renewed - session.expiresAt > PERSIST_RENEWAL_MS;
  session.expiresAt = renewed;
  if (persist) saveStore();

  const user = store.users.get(session.userId)!;
  return { id: session.id, user: { id: user.id, name: user.name } };
}

export function useSessionByToken(token: string): Session | null {
  const id = store.sessionIdsByTokenHash.get(hashToken(token));
  return use(id === undefined ? undefined : store.sessions.get(id));
}

export function useSessionById(id: number): Session | null {
  return use(store.sessions.get(id));
}

/** Checks a session without counting it as use (for background sweeps). */
export function isSessionActive(id: number): boolean {
  const session = store.sessions.get(id);
  return !!session && Date.now() < session.expiresAt;
}

function removeSession(id: number): boolean {
  const session = store.sessions.get(id);
  if (!session) return false;
  store.sessions.delete(id);
  store.sessionIdsByTokenHash.delete(session.tokenHash);
  return true;
}

export function deleteSession(id: number) {
  if (removeSession(id)) saveStore();
}

/**
 * Ends every session of a user, except `keepSessionId` if given (e.g. the one changing the
 * password). Returns the ended ids.
 */
export function deleteUserSessions(userId: number, keepSessionId?: number): number[] {
  const ended: number[] = [];
  for (const session of store.sessions.values()) {
    if (session.userId === userId && session.id !== keepSessionId) {
      removeSession(session.id);
      ended.push(session.id);
    }
  }
  if (ended.length) saveStore();
  return ended;
}

export function deleteExpiredSessions() {
  const now = Date.now();
  let removed = false;
  for (const session of store.sessions.values()) {
    if (now >= session.expiresAt) removed = removeSession(session.id) || removed;
  }
  if (removed) saveStore();
}
