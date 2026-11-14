// The application's data, held in memory while the server runs. Every change is also
// written to a JSON file on the VM's disk (see persistence.ts) and read back on start,
// so the data survives restarts. There is no database or cloud storage.
//
// The services are the only code that touches these maps. Node runs JavaScript on a
// single thread, so a synchronous read-check-write in a service can't interleave with
// another request: there are no partial updates to guard against.

export interface UserRecord {
  id: number;
  name: string;
  /** Normalized (trimmed, lowercase): the account identifier. */
  email: string;
  passwordHash: string;
  createdAt: number;
  /**
   * Set when the user deleted their account. The record stays (anonymized) because
   * auctions, bids and results keep referring to it; see services/users.ts.
   */
  deletedAt: number | null;
}

/** What is being sold. An item can be auctioned more than once (e.g. relisted). */
export interface ItemRecord {
  id: number;
  sellerId: number;
  title: string;
  description: string;
  category: string;
  /** URLs; the first one is the cover. */
  photos: string[];
  createdAt: number;
}

/** One sale of an item. Money in cents, times in epoch milliseconds. */
export interface AuctionRecord {
  id: number;
  itemId: number;
  /** Same as the item's; kept here because every bid checks it. */
  sellerId: number;
  startingPrice: number;
  currentPrice: number;
  highestBidderId: number | null;
  bidCount: number;
  featured: boolean;
  startsAt: number;
  /** The end in force: later than `originalEndsAt` when late bids extended it (RF15). */
  endsAt: number;
  originalEndsAt: number;
  /** Cancelled by the seller (RF08); the record is kept, never deleted. */
  cancelledAt: number | null;
  /**
   * When the lifecycle job saw it open and close (RF17). The state itself always follows from the
   * times and bids (see `auctionStatus`); these only record that each transition was handled,
   * once, so it's announced once even across restarts (RF18).
   */
  openedAt: number | null;
  closedAt: number | null;
  createdAt: number;
}

export interface BidRecord {
  id: number;
  auctionId: number;
  userId: number;
  amount: number;
  createdAt: number;
  /** Sent by the client to recognize the same bid sent again (RF12). Kept with the bid, so it works after a restart. */
  idempotencyKey: string | null;
}

/** Index key of a bid sent with an idempotency key: the same key only matches the same user and auction. */
export const bidKey = (userId: number, auctionId: number, idempotencyKey: string) => `${userId}:${auctionId}:${idempotencyKey}`;

export interface SessionRecord {
  id: number;
  userId: number;
  /** Only a hash of the token is kept, never the token itself. */
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  absoluteExpiresAt: number;
}

/** Wrong-password streak for one email (login brute-force protection). */
export interface LoginAttemptsRecord {
  failures: number;
  /** Password checks started but not finished yet (hashing is async). */
  inFlight: number;
  lastFailureAt: number;
  lockedUntil: number;
}

export const store = {
  users: new Map<number, UserRecord>(),
  userIdsByEmail: new Map<string, number>(),
  items: new Map<number, ItemRecord>(),
  auctions: new Map<number, AuctionRecord>(),
  /** Oldest first. */
  bidsByAuction: new Map<number, BidRecord[]>(),
  /** See `bidKey`. */
  bidsByKey: new Map<string, BidRecord>(),
  sessions: new Map<number, SessionRecord>(),
  sessionIdsByTokenHash: new Map<string, number>(),
  /** Keyed by normalized email, whether or not an account exists for it. */
  loginAttempts: new Map<string, LoginAttemptsRecord>(),
};

type IdKind = 'user' | 'item' | 'auction' | 'bid' | 'session';

const lastIds: Record<IdKind, number> = { user: 0, item: 0, auction: 0, bid: 0, session: 0 };

export const nextId = (kind: IdKind) => ++lastIds[kind];

/** After loading saved data, continue numbering after the highest existing ids. */
export function restoreIds(ids: Record<IdKind, number>) {
  Object.assign(lastIds, ids);
}
