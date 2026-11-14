// Types and logic shared between the server and the client.
// All money values are integers in cents.

export interface PublicUser {
  id: number;
  name: string;
  email: string;
  createdAt: string; // ISO date
}

/** What the user must type to confirm deleting their account. */
export const DELETE_ACCOUNT_CONFIRMATION = 'DELETAR';

/** Shown instead of the name of a deleted account (its history is kept, anonymized). */
export const DELETED_ACCOUNT_NAME = 'Conta excluída';

/** What still prevents a user from deleting their account. Empty lists mean it can be deleted. */
export interface AccountDeletionBlockers {
  /** Their own auctions that are scheduled or live. */
  auctions: { id: number; title: string; status: 'scheduled' | 'live' }[];
  /** Live auctions where they placed a bid (bids can't be undone, RF10). */
  bids: { id: number; title: string }[];
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

/**
 * Masks a user's display name to identify them without exposing their full name (RF09).
 * E.g. "Carlos Eduardo da Silva" -> "Carlos S.", "Calvin" -> "C***n"
 */
export function maskBidderName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Anônimo';
  const parts = trimmed.split(' ');
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    return `${first} ${last[0].toUpperCase()}.`;
  }
  if (trimmed.length <= 2) return `${trimmed[0]}*`;
  return `${trimmed[0]}${'*'.repeat(Math.max(1, trimmed.length - 2))}${trimmed[trimmed.length - 1]}`;
}

/**
 * An auction as the API sends it: the item's data (name, description, category, photos)
 * merged with this auction of it (start, end, prices). An item can be auctioned more than
 * once over time, so the two are stored separately.
 */
export interface Auction {
  id: number;
  itemId: number;
  title: string;
  description: string;
  category: string;
  /** URLs; the first one is the cover. */
  photos: string[];
  startingPrice: number;
  currentPrice: number;
  /** Increment at the current price (RF14), computed by the server from the table below. */
  minIncrement: number;
  /** The lowest amount the next bid can have (RF14), computed by the server; screens only display it. */
  minBid: number;
  bidCount: number;
  featured: boolean;
  sellerId: number;
  sellerName: string;
  startsAt: string; // ISO date
  /** The end in force, including extensions by late bids (RF15). */
  endsAt: string; // ISO date
  /** The end as scheduled; `endsAt` is later when late bids extended it (RF15). */
  originalEndsAt: string; // ISO date
  /** Set when the seller cancelled it (RF08). Cancelled auctions are kept, never deleted. */
  cancelledAt: string | null; // ISO date
  // No bidder information here: listings are public. Who bid is only shown inside the room (RF04, RF09).
}

/** The five states an auction can be in (RN01). */
export type AuctionStatus = 'scheduled' | 'live' | 'sold' | 'unsold' | 'cancelled';

export const AUCTION_STATUS_LABELS: Record<AuctionStatus, string> = {
  scheduled: 'Agendado',
  live: 'Em andamento',
  sold: 'Vendido',
  unsold: 'Encerrado sem lances',
  cancelled: 'Cancelado',
};

type StatusFields = Pick<Auction, 'startsAt' | 'endsAt' | 'bidCount' | 'cancelledAt'>;

/** An auction's state at a given moment. The server's answer is the one that counts (RF16). */
export function auctionStatus(auction: StatusFields, now: number): AuctionStatus {
  if (auction.cancelledAt) return 'cancelled';
  if (now < Date.parse(auction.startsAt)) return 'scheduled';
  if (now < Date.parse(auction.endsAt)) return 'live';
  return auction.bidCount > 0 ? 'sold' : 'unsold';
}

/** Scheduled or live: the auctions the public listing shows (RF20). */
export const isOpenStatus = (status: AuctionStatus) => status === 'scheduled' || status === 'live';

/**
 * Team decision (RF20): the order of the public listing. Live auctions first, ending soonest on
 * top (they're the ones that need attention now), then scheduled ones, starting soonest.
 */
export function listingOrder(a: StatusFields, b: StatusFields, now: number): number {
  const key = (auction: StatusFields) =>
    auctionStatus(auction, now) === 'live' ? [0, Date.parse(auction.endsAt)] : [1, Date.parse(auction.startsAt)];
  const [groupA, timeA] = key(a);
  const [groupB, timeB] = key(b);
  return groupA - groupB || timeA - timeB;
}

/** Auctions per page of the public listing (RF20). */
export const LISTING_PAGE_SIZE = 12;

/** A page of the public listing, and how many auctions match in all. */
export interface AuctionPage {
  auctions: Auction[];
  total: number;
}

/** RF08: the seller may cancel while it's scheduled, or live without any bid. */
export const canCancel = (auction: StatusFields, now: number) => {
  const status = auctionStatus(auction, now);
  return status === 'scheduled' || (status === 'live' && auction.bidCount === 0);
};

export interface Bid {
  id: number;
  auctionId: number;
  amount: number;
  /** Masked (RF09), e.g. "Carla V.". */
  bidderName: string;
  /**
   * Opaque tag for the bidder, the same for all their bids in this auction and different in
   * every other one, so it can't be used to follow someone across auctions or match them to
   * a seller. Compare it with `viewerTag` from `room:join` to tell which bids are yours.
   */
  bidderTag: string;
  createdAt: string; // ISO date
}

export interface AuctionDetail extends Auction {
  recentBids: Bid[];
}

/**
 * Limits for creating an auction (RF05), and the extension rule (RF15). The server owns them
 * (see `server/src/config.ts`, RF06) and publishes them at `GET /api/auctions/rules`, so the
 * screens always match.
 */
export interface ListingRules {
  categories: readonly string[];
  titleLength: { min: number; max: number };
  descriptionLength: { min: number; max: number };
  photos: { min: number; max: number; maxBytes: number; types: readonly string[] };
  /** In cents. */
  price: { min: number; max: number };
  /** How far ahead the start can be scheduled. */
  leadMinutes: { min: number; max: number };
  durationMinutes: { min: number; max: number };
  /**
   * Team decision (RF15): a bid leaving less than `windowMinutes` on the clock moves the end to
   * `windowMinutes` after the bid, up to `maxMinutes` past the original end in all.
   */
  extension: { windowMinutes: number; maxMinutes: number };
}

/** Text fields of the "create auction" form (sent as multipart, next to the `photos` files). */
export interface CreateAuctionFields {
  title: string;
  description: string;
  category: string;
  startingPrice: number;
  /** ISO date; omitted means "as soon as allowed". */
  startsAt?: string;
  durationMinutes: number;
}

/** Sent (HTTP 401 body or socket ack) when the session is missing, expired or was logged out. */
export const SESSION_INVALID = 'SESSION_INVALID';

export type Failure = { ok: false; error: string; code?: typeof SESSION_INVALID };

export type BidFailureCode =
  | typeof SESSION_INVALID
  | 'RATE_LIMITED'
  | 'BELOW_MINIMUM'
  /** Bids are only accepted from inside the auction's room (RF10). */
  | 'NOT_IN_ROOM'
  /** Not live: scheduled, over or cancelled. */
  | 'NOT_IN_PROGRESS'
  | 'SELF_BID'
  | 'ALREADY_LEADER'
  | 'INVALID_BID';

export type BidFailure = {
  ok: false;
  error: string;
  code?: BidFailureCode;
  currentMinBid?: number;
};

/**
 * `bid` is the accepted bid. When the same bid is sent again (same `idempotencyKey`), it's the
 * original one and nothing new is created (RF12); `auction` is always the current state.
 */
export type BidResult = { ok: true; auction: Auction; bid: Bid } | BidFailure;

/** The highest bid accepted, in cents (R$ 100.000.000,00, the highest starting price), so amounts stay exact. */
export const MAX_BID = 100_000_000_00;

/** Max length of a bid's `idempotencyKey`. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 100;

/** RF25: whether a user joined a room as a bidder (participant) or a viewer (spectator). */
export type RoomMode = 'participant' | 'spectator';

/**
 * Returned by room:join and room:upgrade. `mode` is the role the server gave (a seller always
 * watches their own auction); `viewerTag` is the `bidderTag` your bids have in this auction.
 */
export type JoinRoomResult = { ok: true; auction: AuctionDetail; mode: RoomMode; viewerTag: string } | Failure;

/**
 * Live headcount emitted to all room members whenever someone enters, leaves,
 * or upgrades from spectator to participant (RF25).
 */
export interface RoomPresence {
  auctionId: number;
  /** People who can bid (several tabs of one user count once). */
  participants: number;
  /** People only watching (someone also participating in another tab isn't counted here). */
  spectators: number;
}

export interface ServerToClientEvents {
  /** Public: a new listing was published. */
  'auction:created': (auction: Auction) => void;
  /** Public: listing data changed (price, bid count). Carries no bidder information. */
  'auction:updated': (auction: Auction) => void;
  /** Room members only: a bid was accepted in this auction's room. */
  'room:bid': (payload: { auction: Auction; bid: Bid }) => void;
  /** This connection's session ended (expired or logged out); it was removed from every room. */
  'session:expired': () => void;
  /** Sent to everyone in an auction's room whenever the headcount changes (RF25). */
  'room:presence': (payload: RoomPresence) => void;
}

export interface ClientToServerEvents {
  /** Anyone: the server's current time (epoch ms), so countdowns follow the server's clock (RF16). */
  'clock:sync': (ack: (serverNow: number) => void) => void;
  /** RF04 / RF25: join as spectator or participant. Login is required either way. */
  'room:join': (auctionId: number, mode: RoomMode, ack: (result: JoinRoomResult) => void) => void;
  /** RF25: promote from spectator to participant without leaving the room. */
  'room:upgrade': (auctionId: number, ack: (result: JoinRoomResult) => void) => void;
  /** Leaves the auction's room, whichever the mode. */
  'room:leave': (auctionId: number) => void;
  /** `idempotencyKey`: one per bid intent, reused when re-sending it (RF12). */
  'bid:place': (
    payload: { auctionId: number; amount: number; idempotencyKey?: string },
    ack: (result: BidResult) => void,
  ) => void;
}

/**
 * Increment table by current price level (RF14). All values in cents.
 * Até R$ 99,99 -> R$ 1,00 (100 centavos)
 * R$ 100,00 a R$ 499,99 -> R$ 5,00 (500 centavos)
 * R$ 500,00 a R$ 999,99 -> R$ 10,00 (1.000 centavos)
 * R$ 1.000,00 a R$ 4.999,99 -> R$ 50,00 (5.000 centavos)
 * R$ 5.000,00 a R$ 24.999,99 -> R$ 100,00 (10.000 centavos)
 * A partir de R$ 25.000,00 -> R$ 500,00 (50.000 centavos)
 */
export function calculateMinIncrement(currentPriceInCents: number): number {
  if (currentPriceInCents <= 9_999) return 100;
  if (currentPriceInCents <= 49_999) return 500;
  if (currentPriceInCents <= 99_999) return 1_000;
  if (currentPriceInCents <= 499_999) return 5_000;
  if (currentPriceInCents <= 2_499_999) return 10_000;
  return 50_000;
}

/**
 * The lowest amount the next bid can have (RF14).
 * The first bid may match the starting price.
 * Subsequent bids must increment at least according to the official table.
 */
export function minNextBid(auction: Pick<Auction, 'bidCount' | 'currentPrice'>): number {
  return auction.bidCount === 0 ? auction.currentPrice : auction.currentPrice + calculateMinIncrement(auction.currentPrice);
}
