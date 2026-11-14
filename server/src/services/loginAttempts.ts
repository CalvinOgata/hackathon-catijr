import { config } from '../config';
import { store, type LoginAttemptsRecord } from '../store';

// Limits wrong passwords per email. Emails without an account are tracked the same
// way, so the responses don't reveal which emails are registered.
//
// Checking a password is async (scrypt), so a burst of simultaneous attempts would all
// pass a plain "failures < max" check before any of them failed. Attempts therefore
// reserve a slot synchronously before hashing: never more than `maxAttempts` wrong
// passwords get checked per lock window, however many arrive at once.

export type AttemptStart = { allowed: true } | { allowed: false; retryAfterMs: number };

export type AttemptOutcome = { locked: false; remaining: number } | { locked: true; retryAfterMs: number };

function current(email: string, now: number): LoginAttemptsRecord {
  let record = store.loginAttempts.get(email);
  if (!record) {
    record = { failures: 0, inFlight: 0, lastFailureAt: 0, lockedUntil: 0 };
    store.loginAttempts.set(email, record);
  }
  // An expired lock, or a streak that went quiet for a full lock period, starts over
  if ((record.lockedUntil && record.lockedUntil <= now) || now - record.lastFailureAt >= config.login.lockMs) {
    record.failures = 0;
    record.lockedUntil = 0;
  }
  return record;
}

/** Call before checking a password. Every allowed start must be followed by `finishAttempt`. */
export function startAttempt(email: string): AttemptStart {
  const now = Date.now();
  const record = current(email, now);

  if (record.lockedUntil > now) return { allowed: false, retryAfterMs: record.lockedUntil - now };
  if (record.failures + record.inFlight >= config.login.maxAttempts) {
    // Other attempts are still being checked; if they all fail, this is the lock that follows
    return { allowed: false, retryAfterMs: config.login.lockMs };
  }

  record.inFlight++;
  return { allowed: true };
}

/** Releases a started attempt without counting it (e.g. the check itself crashed). */
export function cancelAttempt(email: string) {
  const record = store.loginAttempts.get(email);
  if (record) record.inFlight = Math.max(0, record.inFlight - 1);
}

export function finishAttempt(email: string, success: boolean): AttemptOutcome {
  const now = Date.now();
  const record = current(email, now);
  record.inFlight = Math.max(0, record.inFlight - 1);

  if (success) {
    record.failures = 0;
    record.lockedUntil = 0;
    if (record.inFlight === 0) store.loginAttempts.delete(email);
    return { locked: false, remaining: config.login.maxAttempts };
  }

  record.failures++;
  record.lastFailureAt = now;
  if (record.failures >= config.login.maxAttempts) {
    record.lockedUntil = now + config.login.lockMs;
    return { locked: true, retryAfterMs: config.login.lockMs };
  }
  return { locked: false, remaining: config.login.maxAttempts - record.failures };
}

/** Forgets streaks that no longer matter, so the map doesn't grow forever. */
export function pruneLoginAttempts() {
  const now = Date.now();
  for (const [email, record] of store.loginAttempts) {
    if (record.inFlight === 0 && record.lockedUntil <= now && now - record.lastFailureAt >= config.login.lockMs) {
      store.loginAttempts.delete(email);
    }
  }
}

const minutes = (ms: number) => {
  const value = Math.max(1, Math.ceil(ms / 60_000));
  return value === 1 ? '1 minuto' : `${value} minutos`;
};

export const lockedMessage = (retryAfterMs: number) =>
  `Muitas tentativas com senha incorreta. Tente novamente em ${minutes(retryAfterMs)}.`;

export const remainingMessage = (remaining: number) =>
  remaining === 1 ? 'Resta 1 tentativa antes do bloqueio.' : `Restam ${remaining} tentativas antes do bloqueio.`;
