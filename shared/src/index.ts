// Types and logic shared between the server and the client.
// All money values are integers in cents.

export interface PublicUser {
  id: number;
  name: string;
  email: string;
  createdAt: string; // ISO date
}

/** Applied after trimming and collapsing repeated spaces. */
export const DISPLAY_NAME_LENGTH = { min: 2, max: 60 } as const;

export const normalizeDisplayName = (name: string) => name.trim().replace(/\s+/g, ' ');

export const PASSWORD_LENGTH = { min: 8, max: 128 } as const;

/**
 * Password policy, checked by the server (the authority) and shown live in the forms.
 * Labels are user-facing, hence in Portuguese.
 */
export const PASSWORD_RULES = [
  { label: `De ${PASSWORD_LENGTH.min} a ${PASSWORD_LENGTH.max} caracteres`, test: (p: string) => p.length >= PASSWORD_LENGTH.min && p.length <= PASSWORD_LENGTH.max },
  { label: 'Uma letra minúscula', test: (p: string) => /\p{Ll}/u.test(p) },
  { label: 'Uma letra maiúscula', test: (p: string) => /\p{Lu}/u.test(p) },
  { label: 'Um número', test: (p: string) => /\p{N}/u.test(p) },
  { label: 'Um símbolo (ex.: ! @ # $ %)', test: (p: string) => /[^\p{L}\p{N}\s]/u.test(p) },
] as const;

/** Labels of the rules the password breaks; empty when it's acceptable. */
export const passwordProblems = (password: string): string[] =>
  PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.label);

export interface AuthResponse {
  token: string;
  user: PublicUser;
}

/** Shown as-is in the UI, so they're in Portuguese. */
export const CATEGORIES = ['Arte', 'Colecionáveis', 'Design', 'Eletrônicos', 'Moda', 'Música', 'Relógios', 'Veículos', 'Outros'] as const;

export type Category = (typeof CATEGORIES)[number];

export interface Auction {
  id: number;
  title: string;
  description: string;
  imageUrl: string; // may be empty
  category: string;
  startingPrice: number;
  currentPrice: number;
  minIncrement: number;
  bidCount: number;
  featured: boolean;
  sellerId: number;
  sellerName: string;
  endsAt: string; // ISO date
}

export interface Bid {
  id: number;
  auctionId: number;
  amount: number;
  bidderName: string;
  createdAt: string; // ISO date
}

export interface AuctionDetail extends Auction {
  recentBids: Bid[];
}

/** Limits for listing a new item, enforced by the server and mirrored in the form. */
export const LISTING_LIMITS = {
  minDurationMinutes: 5,
  maxDurationMinutes: 30 * 24 * 60,
  minPrice: 100, // R$ 1,00
  maxPrice: 100_000_000_00, // R$ 100 million
} as const;

export interface CreateAuctionInput {
  title: string;
  description: string;
  category: Category;
  imageUrl?: string;
  startingPrice: number;
  minIncrement: number;
  durationMinutes: number;
}

/** Sent (HTTP 401 body or socket ack) when the session is missing, expired or was logged out. */
export const SESSION_INVALID = 'SESSION_INVALID';

export type Failure = { ok: false; error: string; code?: typeof SESSION_INVALID };

export type BidResult = { ok: true } | Failure;

export type JoinRoomResult = { ok: true; auction: AuctionDetail } | Failure;

export interface ServerToClientEvents {
  /** Public: a new listing was published. */
  'auction:created': (auction: Auction) => void;
  /** Public: listing data changed (price, bid count). Carries no bidder information. */
  'auction:updated': (auction: Auction) => void;
  /** Room members only: a bid was accepted in this auction's room. */
  'room:bid': (payload: { auction: Auction; bid: Bid }) => void;
  /** This connection's session ended (expired or logged out); it was removed from every room. */
  'session:expired': () => void;
}

export interface ClientToServerEvents {
  'room:join': (auctionId: number, ack: (result: JoinRoomResult) => void) => void;
  'room:leave': (auctionId: number) => void;
  'bid:place': (payload: { auctionId: number; amount: number }, ack: (result: BidResult) => void) => void;
}

/** The lowest amount the next bid can have. The first bid may match the starting price. */
export function minNextBid(auction: Pick<Auction, 'bidCount' | 'currentPrice' | 'minIncrement'>): number {
  return auction.bidCount === 0 ? auction.currentPrice : auction.currentPrice + auction.minIncrement;
}
