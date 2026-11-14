import { CATEGORIES, type ListingRules } from '@auction/shared';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');

const MINUTE = 60 * 1000;
const DAY = 24 * 60;

const env = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

/**
 * Team decision (RF05): every limit for creating an auction. They all live here so they're
 * easy to change (RF06); the time and photo limits can also be overridden in `.env`, e.g. for
 * a demo where an auction opens in 1 minute and lasts 3.
 */
const listing: ListingRules = {
  categories: CATEGORIES,
  titleLength: { min: 3, max: 100 },
  descriptionLength: { min: 10, max: 2000 },
  photos: {
    // RF05 requires at least 3 photos, so the minimum can't be configured below that
    min: Math.max(3, env('LISTING_MIN_PHOTOS', 3)),
    max: env('LISTING_MAX_PHOTOS', 8),
    maxBytes: env('LISTING_MAX_PHOTO_MB', 5) * 1024 * 1024,
    types: ['image/jpeg', 'image/png', 'image/webp'],
  },
  price: { min: 100, max: 100_000_000_00 }, // R$ 1,00 to R$ 100 million
  leadMinutes: { min: env('LISTING_MIN_LEAD_MINUTES', 1), max: env('LISTING_MAX_LEAD_DAYS', 30) * DAY },
  durationMinutes: { min: env('LISTING_MIN_DURATION_MINUTES', 3), max: env('LISTING_MAX_DURATION_DAYS', 7) * DAY },
  // Team decision (RF15): the reference rule. Late bids can't win without giving others time to
  // answer, and the 30-minute cap keeps an auction from going on forever.
  extension: { windowMinutes: env('BID_EXTENSION_WINDOW_MINUTES', 2), maxMinutes: env('BID_EXTENSION_MAX_MINUTES', 30) },
};

export const config = {
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 3333),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  /** Where the JSON data file and the uploaded photos are kept, on the VM's disk. */
  dataDir: process.env.DATA_DIR ?? 'data',
  /** The built web app (`npm run build -w client`), served by this process when it exists (RNF01). */
  clientDir: resolve(process.env.CLIENT_DIR ?? '../client/build'),
  listing,
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
