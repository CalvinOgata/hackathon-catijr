import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const MINUTE = 60 * 1000;

export const config = {
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 3333),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  login: {
    // Team decision: after this many wrong passwords in a row, the account's login is
    // locked for a while (also counts wrong "current password" on the account page).
    maxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS ?? 3),
    lockMs: Number(process.env.LOGIN_LOCK_MINUTES ?? 15) * MINUTE,
  },
  session: {
    // Team decision (RF02): sliding sessions. Each authenticated action renews the
    // idle timeout, but a session never outlives its absolute lifetime.
    idleTimeoutMs: Number(process.env.SESSION_IDLE_MINUTES ?? 120) * MINUTE,
    maxLifetimeMs: Number(process.env.SESSION_MAX_DAYS ?? 7) * 24 * 60 * MINUTE,
  },
};
