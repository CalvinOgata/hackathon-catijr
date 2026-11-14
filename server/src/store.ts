// All application data lives here, in the memory of the server process. Nothing is
// written to disk, a database or any external storage: restarting the server resets it.
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
}

/** Money in cents, times in epoch milliseconds. */
export interface AuctionRecord {
  id: number;
  title: string;
  description: string;
  imageUrl: string;
  category: string;
  startingPrice: number;
  currentPrice: number;
  minIncrement: number;
  highestBidderId: number | null;
  bidCount: number;
  featured: boolean;
  sellerId: number;
  endsAt: number;
  createdAt: number;
}

export interface BidRecord {
  id: number;
  auctionId: number;
  userId: number;
  amount: number;
  createdAt: number;
}

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
  auctions: new Map<number, AuctionRecord>(),
  /** Oldest first. */
  bidsByAuction: new Map<number, BidRecord[]>(),
  sessions: new Map<number, SessionRecord>(),
  sessionIdsByTokenHash: new Map<string, number>(),
  /** Keyed by normalized email, whether or not an account exists for it. */
  loginAttempts: new Map<string, LoginAttemptsRecord>(),
};

const lastIds = { user: 0, auction: 0, bid: 0, session: 0 };

export const nextId = (kind: keyof typeof lastIds) => ++lastIds[kind];
