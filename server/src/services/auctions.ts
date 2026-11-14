import { createHmac, randomBytes } from 'node:crypto';
import {
  auctionStatus,
  calculateMinIncrement,
  canCancel,
  DELETED_ACCOUNT_NAME,
  isOpenStatus,
  listingOrder,
  MAX_BID,
  maskBidderName,
  minNextBid,
  type AccountDeletionBlockers,
  type Auction,
  type AuctionDetail,
  type AuctionPage,
  type Bid,
  type BidFailureCode,
} from '@auction/shared';
import { config } from '../config';
import { saveStore } from '../persistence';
import { bidKey, nextId, store, type AuctionRecord, type BidRecord, type ItemRecord } from '../store';

const RECENT_BIDS = 10;

function toAuction(record: AuctionRecord): Auction {
  const item = store.items.get(record.itemId)!;
  return {
    id: record.id,
    itemId: item.id,
    title: item.title,
    description: item.description,
    category: item.category,
    photos: item.photos,
    startingPrice: record.startingPrice,
    currentPrice: record.currentPrice,
    minIncrement: calculateMinIncrement(record.currentPrice),
    minBid: minNextBid(record),
    bidCount: record.bidCount,
    featured: record.featured,
    sellerId: record.sellerId,
    sellerName: store.users.get(record.sellerId)!.name,
    startsAt: new Date(record.startsAt).toISOString(),
    endsAt: new Date(record.endsAt).toISOString(),
    originalEndsAt: new Date(record.originalEndsAt).toISOString(),
    cancelledAt: record.cancelledAt === null ? null : new Date(record.cancelledAt).toISOString(),
  };
}

// Bidders are told apart by a tag derived from the auction and the user with a secret key,
// never by their user id: ids are shared with seller data (where full names are public), so
// they would reveal who is bidding (RF09). A new key on each start only changes the tags;
// clients get fresh ones when they rejoin the room after reconnecting.
const TAG_KEY = randomBytes(32);

export const bidderTag = (auctionId: number, userId: number) =>
  createHmac('sha256', TAG_KEY).update(`${auctionId}:${userId}`).digest('base64url').slice(0, 16);

function toBid(record: BidRecord): Bid {
  const user = store.users.get(record.userId)!;
  return {
    id: record.id,
    auctionId: record.auctionId,
    amount: record.amount,
    // A deleted account's placeholder is shown as is, not masked into "Conta E."
    bidderName: user.deletedAt === null ? maskBidderName(user.name) : DELETED_ACCOUNT_NAME,
    bidderTag: bidderTag(record.auctionId, record.userId),
    createdAt: new Date(record.createdAt).toISOString(),
  };
}

/** Lowercase without accents, so "jacaranda" finds "jacarandá". */
const searchable = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * The public listing (RF20): only scheduled and live auctions, live ones ending soonest first,
 * then scheduled ones starting soonest (see `listingOrder`), a page at a time. The search looks
 * in the name, description and category, ignoring accents and case; the category must match
 * exactly. Ended and cancelled auctions stay reachable by their link.
 */
export function listAuctions({ search, category, offset = 0, limit }: { search?: string; category?: string; offset?: number; limit: number }): AuctionPage {
  const now = Date.now();
  const term = search && searchable(search);
  const matching = [...store.auctions.values()]
    .filter((record) => {
      const item = store.items.get(record.itemId)!;
      if (category && item.category !== category) return false;
      return !term || [item.title, item.description, item.category].some((field) => searchable(field).includes(term));
    })
    .map(toAuction)
    .filter((auction) => isOpenStatus(auctionStatus(auction, now)))
    .sort((a, b) => listingOrder(a, b, now));
  return { auctions: matching.slice(offset, offset + limit), total: matching.length };
}

/** Featured auctions still open, for the home page carousel; the first open one if none is. */
export function featuredAuctions(max: number): Auction[] {
  const { auctions } = listAuctions({ limit: Number.MAX_SAFE_INTEGER });
  const featured = auctions.filter((auction) => auction.featured);
  return (featured.length ? featured : auctions).slice(0, featured.length ? max : 1);
}

export function getAuction(id: number): Auction | undefined {
  const record = store.auctions.get(id);
  return record && toAuction(record);
}

export function getAuctionDetail(id: number): AuctionDetail | undefined {
  const auction = getAuction(id);
  if (!auction) return undefined;
  const recentBids = (store.bidsByAuction.get(id) ?? []).slice(-RECENT_BIDS).reverse().map(toBid);
  return { ...auction, recentBids };
}

export interface NewAuction {
  title: string;
  description: string;
  category: string;
  photos: string[];
  startingPrice: number;
  startsAt: number;
  durationMinutes: number;
  featured?: boolean;
}

/** Creates the item and its first auction. Inputs must already be validated (see listings.ts). */
export function createAuction(sellerId: number, input: NewAuction): Auction {
  const now = Date.now();
  const item: ItemRecord = {
    id: nextId('item'),
    sellerId,
    title: input.title,
    description: input.description,
    category: input.category,
    photos: input.photos,
    createdAt: now,
  };
  const auction: AuctionRecord = {
    id: nextId('auction'),
    itemId: item.id,
    sellerId,
    startingPrice: input.startingPrice,
    currentPrice: input.startingPrice,
    highestBidderId: null,
    bidCount: 0,
    featured: input.featured ?? false,
    startsAt: input.startsAt,
    endsAt: input.startsAt + input.durationMinutes * 60 * 1000,
    originalEndsAt: input.startsAt + input.durationMinutes * 60 * 1000,
    cancelledAt: null,
    openedAt: null,
    closedAt: null,
    createdAt: now,
  };

  store.items.set(item.id, item);
  store.auctions.set(auction.id, auction);
  store.bidsByAuction.set(auction.id, []);
  saveStore();
  return toAuction(auction);
}

/**
 * What keeps a user from deleting their account: their own auctions still scheduled or
 * live, and live auctions where they placed a bid (bids are irrevocable, RF10).
 */
export function accountDeletionBlockers(userId: number, now = Date.now()): AccountDeletionBlockers {
  const blockers: AccountDeletionBlockers = { auctions: [], bids: [] };
  for (const record of store.auctions.values()) {
    const auction = toAuction(record);
    const status = auctionStatus(auction, now);
    if (status !== 'scheduled' && status !== 'live') continue;

    if (record.sellerId === userId) blockers.auctions.push({ id: auction.id, title: auction.title, status });
    else if (status === 'live' && store.bidsByAuction.get(record.id)!.some((bid) => bid.userId === userId)) {
      blockers.bids.push({ id: auction.id, title: auction.title });
    }
  }
  return blockers;
}

export class CancelError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * RF08: the seller cancels their own auction while it's scheduled, or live without bids.
 * Nothing is deleted: the auction stays, marked as cancelled. Like bids, this runs
 * synchronously, so a bid and a cancellation arriving together can't both succeed.
 */
export function cancelAuction(auctionId: number, userId: number): Auction {
  const record = store.auctions.get(auctionId);
  if (!record) throw new CancelError(404, 'Leilão não encontrado');
  if (record.sellerId !== userId) throw new CancelError(403, 'Só quem anunciou o leilão pode cancelá-lo');

  const now = Date.now();
  const auction = toAuction(record);
  if (!canCancel(auction, now)) {
    const status = auctionStatus(auction, now);
    if (status === 'cancelled') throw new CancelError(409, 'Este leilão já foi cancelado');
    if (status === 'live') throw new CancelError(409, 'Leilões com lances não podem ser cancelados');
    throw new CancelError(409, 'Este leilão já terminou e não pode mais ser cancelado');
  }

  record.cancelledAt = now;
  try {
    saveStore();
  } catch (err) {
    record.cancelledAt = null; // not on disk, so not cancelled (same as a failed bid)
    throw err;
  }
  return toAuction(record);
}

export class BidError extends Error {
  currentMinBid: number;
  code?: BidFailureCode;

  constructor(message: string, currentMinBid: number, code?: BidFailureCode) {
    super(message);
    this.currentMinBid = currentMinBid;
    this.code = code;
  }
}

/** RF13: minimum time between bid attempts of the same user. */
const BID_INTERVAL_MS = 500;

/** Each user's last bid attempt that was processed (RF13). Not saved: it only matters for a moment. */
const lastAttemptByUser = new Map<number, { at: number; key: string | undefined }>();

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const MINUTE = 60 * 1000;

/**
 * RF15: a bid leaving less than the window on the clock moves the end to one window after the
 * bid, but never more than the maximum past the original end. Checked after the bid was
 * accepted, so it was placed before the end (RF16) and the auction can't close in between.
 */
function extendedEnd(auction: AuctionRecord, bidAt: number): number {
  const { windowMinutes, maxMinutes } = config.listing.extension;
  if (auction.endsAt - bidAt >= windowMinutes * MINUTE) return auction.endsAt;
  const latest = auction.originalEndsAt + maxMinutes * MINUTE;
  return Math.max(auction.endsAt, Math.min(bidAt + windowMinutes * MINUTE, latest));
}

/**
 * Validates and records a bid according to RF10 to RF14.
 * It runs synchronously from check to write, so no other bid on the same auction can slip in between (RF11).
 * The same bid sent again (same idempotencyKey) returns the original bid instead of creating another (RF12).
 * Every attempt counts toward the 500 ms limit per user, not only accepted bids, except a re-send
 * of the same bid; one user's attempts never slow down another's (RF13).
 */
export function placeBid(
  auctionId: number,
  user: { id: number; name: string },
  amount: number,
  idempotencyKey?: string,
  now = Date.now(), // only the sample data passes another time
): { auction: Auction; bid: Bid; isReplay?: boolean } {
  const auction = store.auctions.get(auctionId);
  if (!auction) throw new BidError('Leilão não encontrado', 0, 'INVALID_BID');

  // RF12: checked before anything else, so a re-sent bid gets its original result even if the
  // auction has moved on (outbid, ended) since. The key is saved with the bid, so this also
  // works after a restart.
  const key = idempotencyKey ? bidKey(user.id, auctionId, idempotencyKey) : undefined;
  const original = key && store.bidsByKey.get(key);
  if (original) return { auction: toAuction(auction), bid: toBid(original), isReplay: true };

  const currentAuction = toAuction(auction);
  const minimum = currentAuction.minBid;

  // RF13: checked before the rules, so refused attempts count too. A re-send of the attempt just
  // made (same key, e.g. a retry after no answer) is let through: it's re-checked below and can't
  // create a second bid (RF12). Refused-by-limit attempts don't restart the timer.
  const last = lastAttemptByUser.get(user.id);
  const resend = idempotencyKey !== undefined && last?.key === idempotencyKey;
  if (last && !resend && now - last.at < BID_INTERVAL_MS) {
    throw new BidError('Aguarde um instante antes de enviar outro lance.', minimum, 'RATE_LIMITED');
  }
  lastAttemptByUser.set(user.id, { at: now, key: idempotencyKey });

  // RF10: every condition is checked when the bid is processed, not when it was sent
  const status = auctionStatus(currentAuction, now);
  if (status === 'cancelled') {
    throw new BidError('Este leilão foi cancelado', minimum, 'NOT_IN_PROGRESS');
  }
  if (status === 'scheduled') {
    throw new BidError('Este leilão ainda não começou', minimum, 'NOT_IN_PROGRESS');
  }
  if (status !== 'live') {
    throw new BidError('Este leilão já foi encerrado', minimum, 'NOT_IN_PROGRESS');
  }
  if (auction.sellerId === user.id) {
    throw new BidError('Você não pode dar lances no próprio leilão', minimum, 'SELF_BID');
  }
  if (auction.highestBidderId === user.id) {
    throw new BidError('Você já tem o maior lance', minimum, 'ALREADY_LEADER');
  }

  if (amount > MAX_BID) {
    throw new BidError(`O lance pode ser de no máximo ${money.format(MAX_BID / 100)}`, minimum, 'INVALID_BID');
  }
  if (amount < minimum) {
    throw new BidError(`O lance deve ser de no mínimo ${money.format(minimum / 100)}`, minimum, 'BELOW_MINIMUM');
  }

  const bid: BidRecord = { id: nextId('bid'), auctionId, userId: user.id, amount, createdAt: now, idempotencyKey: idempotencyKey ?? null };
  const bids = store.bidsByAuction.get(auctionId)!;
  const before = { currentPrice: auction.currentPrice, highestBidderId: auction.highestBidderId, bidCount: auction.bidCount, endsAt: auction.endsAt };
  bids.push(bid);
  if (key) store.bidsByKey.set(key, bid);
  auction.currentPrice = amount;
  auction.highestBidderId = user.id;
  auction.bidCount++;
  auction.endsAt = extendedEnd(auction, now);
  try {
    saveStore(); // on disk before anyone is told about it (RF11)
  } catch (err) {
    // Not on disk means not accepted: undo it, or it would be saved silently with the next change
    // while the bidder was told it failed and the room never heard of it
    bids.pop();
    if (key) store.bidsByKey.delete(key);
    Object.assign(auction, before);
    throw err;
  }

  return { auction: toAuction(auction), bid: toBid(bid) };
}
