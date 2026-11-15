import { formatDuration, MINUTE } from '@auction/shared';
import { config } from '../config';
import { AppError } from '../errors';
import { store, type LoginAttemptsRecord } from '../store';
import { hashForMissingUser, verifyPassword } from './passwords';

// Limits wrong passwords per email. Emails without an account are tracked the same
// way, so the responses don't reveal which emails are registered.
//
// Checking a password is async (scrypt), so a burst of simultaneous attempts would all
// pass a plain "failures < max" check before any of them failed. Attempts therefore
// reserve a slot synchronously before hashing: never more than `maxAttempts` wrong
// passwords get checked per lock window, however many arrive at once.

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

const locked = (retryAfterMs: number) =>
  new AppError(
    429,
    `Muitas tentativas com senha incorreta. Tente novamente em ${formatDuration(Math.max(1, Math.ceil(retryAfterMs / MINUTE)))}.`,
    {},
    { 'Retry-After': Math.ceil(retryAfterMs / 1000) },
  );

/**
 * Checks a password within the attempt limit of `email`: login, and confirming the current
 * password on the account page (guessing it from a hijacked session counts the same).
 * Throws a 429 while locked, and `wrong` (with the attempts left) for a wrong password.
 * `hash` is undefined when the email has no account: a real hash is checked anyway, so the
 * answer takes as long and doesn't reveal which emails exist.
 */
export async function checkPassword(email: string, password: string, hash: string | undefined, wrong: { status: number; message: string }) {
  const { maxAttempts, lockMs } = config.login;
  const record = current(email, Date.now());
  if (record.lockedUntil > Date.now()) throw locked(record.lockedUntil - Date.now());
  // Other attempts are still being checked; if they all fail, this is the lock that follows
  if (record.failures + record.inFlight >= maxAttempts) throw locked(lockMs);

  // The record stays in the map while an attempt is in flight, so it's safe to keep using it
  record.inFlight++;
  let valid: boolean;
  try {
    valid = (await verifyPassword(password, hash ?? (await hashForMissingUser()))) && hash !== undefined;
  } finally {
    record.inFlight--; // a crash isn't a wrong password: it's released without counting
  }

  const now = Date.now();
  current(email, now);
  if (valid) {
    record.failures = 0;
    record.lockedUntil = 0;
    if (record.inFlight === 0) store.loginAttempts.delete(email);
    return;
  }

  record.failures++;
  record.lastFailureAt = now;
  if (record.failures >= maxAttempts) {
    record.lockedUntil = now + lockMs;
    throw locked(lockMs);
  }
  const left = maxAttempts - record.failures;
  throw new AppError(wrong.status, `${wrong.message} ${left === 1 ? 'Resta 1 tentativa' : `Restam ${left} tentativas`} antes do bloqueio.`);
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
