import { createHmac, randomBytes } from 'node:crypto';
import {
  auctionStatus,
  calculateMinIncrement,
  canCancel,
  DELETED_ACCOUNT_NAME,
  formatMoney,
  isOpenStatus,
  listingOrder,
  MAX_BID,
  maskBidderName,
  minNextBid,
  MINUTE,
  type AccountDeletionBlockers,
  type Auction,
  type AuctionDetail,
  type AuctionPage,
  type Bid,
  type FailureCode,
} from '@auction/shared';
import { config } from '../config';
import { AppError } from '../errors';
import { transaction } from '../persistence';
import { nextId, store, type AuctionRecord, type BidRecord, type ItemRecord } from '../store';

const RECENT_BIDS = 10;

const iso = (time: number) => new Date(time).toISOString();

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
    startsAt: iso(record.startsAt),
    endsAt: iso(record.endsAt),
    originalEndsAt: iso(record.originalEndsAt),
    cancelledAt: record.cancelledAt === null ? null : iso(record.cancelledAt),
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
    createdAt: iso(record.createdAt),
  };
}

/** Lowercase without accents, so "jacaranda" finds "jacarandá". */
const searchable = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Scheduled and live auctions that pass `filter`, in the listing's order (RF20). */
function openAuctions(filter: (item: ItemRecord) => boolean = () => true): AuctionRecord[] {
  const now = Date.now();
  return [...store.auctions.values()]
    .filter((record) => isOpenStatus(auctionStatus(record, now)) && filter(store.items.get(record.itemId)!))
    .sort((a, b) => listingOrder(a, b, now));
}

/**
 * The public listing (RF20): only scheduled and live auctions, live ones ending soonest first,
 * then scheduled ones starting soonest (see `listingOrder`), a page at a time. The search looks
 * in the name, description and category, ignoring accents and case; the category must match
 * exactly. Ended and cancelled auctions stay reachable by their link.
 */
export function listAuctions({ search, category, offset, limit }: { search?: string; category?: string; offset: number; limit: number }): AuctionPage {
  const term = search && searchable(search);
  const matching = openAuctions(
    (item) =>
      (!category || item.category === category) &&
      (!term || [item.title, item.description, item.category].some((field) => searchable(field).includes(term))),
  );
  return { auctions: matching.slice(offset, offset + limit).map(toAuction), total: matching.length };
}

/** Featured auctions still open, for the home page carousel; the first open one if none is. */
export function featuredAuctions(max: number): Auction[] {
  const open = openAuctions();
  const featured = open.filter((record) => record.featured);
  return (featured.length ? featured.slice(0, max) : open.slice(0, 1)).map(toAuction);
}

export function getAuction(id: number): Auction | undefined {
  const record = store.auctions.get(id);
  return record && toAuction(record);
}

export function getAuctionDetail(id: number): AuctionDetail | undefined {
  const auction = getAuction(id);
  return auction && { ...auction, recentBids: store.bidsByAuction.get(id)!.slice(-RECENT_BIDS).reverse().map(toBid) };
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
  const { title, description, category, photos, startingPrice, startsAt } = input;
  const endsAt = startsAt + input.durationMinutes * MINUTE;
  const item: ItemRecord = { id: nextId('item'), sellerId, title, description, category, photos, createdAt: now };
  const auction: AuctionRecord = {
    id: nextId('auction'),
    itemId: item.id,
    sellerId,
    startingPrice,
    currentPrice: startingPrice,
    highestBidderId: null,
    bidCount: 0,
    featured: input.featured ?? false,
    startsAt,
    endsAt,
    originalEndsAt: endsAt,
    cancelledAt: null,
    openedAt: null,
    closedAt: null,
    createdAt: now,
  };
  transaction(() => {
    store.items.set(item.id, item);
    store.auctions.set(auction.id, auction);
    store.bidsByAuction.set(auction.id, []);
  });
  return toAuction(auction);
}

/**
 * What keeps a user from deleting their account: their own auctions still scheduled or
 * live, and live auctions where they placed a bid (bids are irrevocable, RF10).
 */
export function accountDeletionBlockers(userId: number, now = Date.now()): AccountDeletionBlockers {
  const blockers: AccountDeletionBlockers = { auctions: [], bids: [] };
  for (const record of store.auctions.values()) {
    const status = auctionStatus(record, now);
    if (!isOpenStatus(status)) continue;

    const { title } = store.items.get(record.itemId)!;
    if (record.sellerId === userId) blockers.auctions.push({ id: record.id, title, status });
    else if (status === 'live' && store.bidsByAuction.get(record.id)!.some((bid) => bid.userId === userId)) {
      blockers.bids.push({ id: record.id, title });
    }
  }
  return blockers;
}

/**
 * RF08: the seller cancels their own auction while it's scheduled, or live without bids.
 * Nothing is deleted: the auction stays, marked as cancelled. Like bids, this runs
 * synchronously, so a bid and a cancellation arriving together can't both succeed.
 */
export function cancelAuction(auctionId: number, userId: number): Auction {
  const record = store.auctions.get(auctionId);
  if (!record) throw new AppError(404, 'Leilão não encontrado');
  if (record.sellerId !== userId) throw new AppError(403, 'Só quem anunciou o leilão pode cancelá-lo');

  const now = Date.now();
  if (!canCancel(record, now)) {
    const status = auctionStatus(record, now);
    throw new AppError(
      409,
      status === 'cancelled'
        ? 'Este leilão já foi cancelado'
        : status === 'live'
          ? 'Leilões com lances não podem ser cancelados'
          : 'Este leilão já terminou e não pode mais ser cancelado',
    );
  }

  transaction(() => (record.cancelledAt = now));
  return toAuction(record);
}

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

/** RF13: minimum time between bid attempts of the same user. */
const BID_INTERVAL_MS = 500;

/** Each user's last bid attempt that was processed (RF13). Not saved: it only matters for a moment. */
const lastAttemptByUser = new Map<number, { at: number; key: string | undefined }>();

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
  if (!auction) throw new AppError(404, 'Leilão não encontrado', { code: 'INVALID_BID' });
  const bids = store.bidsByAuction.get(auctionId)!;

  // RF12: checked before anything else, so a re-sent bid gets its original result even if the
  // auction has moved on (outbid, ended) since. The key is saved with the bid, so this also
  // works after a restart.
  const original = idempotencyKey && bids.find((bid) => bid.userId === user.id && bid.idempotencyKey === idempotencyKey);
  if (original) return { auction: toAuction(auction), bid: toBid(original), isReplay: true };

  const minimum = minNextBid(auction);
  const refuse = (message: string, code: FailureCode) => new AppError(409, message, { code, currentMinBid: minimum });

  // RF13: checked before the rules, so refused attempts count too. A re-send of the attempt just
  // made (same key, e.g. a retry after no answer) is let through: it's re-checked below and can't
  // create a second bid (RF12). Refused-by-limit attempts don't restart the timer.
  const last = lastAttemptByUser.get(user.id);
  const resend = idempotencyKey !== undefined && last?.key === idempotencyKey;
  if (last && !resend && now - last.at < BID_INTERVAL_MS) throw refuse('Aguarde um instante antes de enviar outro lance.', 'RATE_LIMITED');
  lastAttemptByUser.set(user.id, { at: now, key: idempotencyKey });

  // RF10: every condition is checked when the bid is processed, not when it was sent
  const status = auctionStatus(auction, now);
  if (status !== 'live') {
    const reason = status === 'cancelled' ? 'foi cancelado' : status === 'scheduled' ? 'ainda não começou' : 'já foi encerrado';
    throw refuse(`Este leilão ${reason}`, 'NOT_IN_PROGRESS');
  }
  if (auction.sellerId === user.id) throw refuse('Você não pode dar lances no próprio leilão', 'SELF_BID');
  if (auction.highestBidderId === user.id) throw refuse('Você já tem o maior lance', 'ALREADY_LEADER');
  if (amount > MAX_BID) throw refuse(`O lance pode ser de no máximo ${formatMoney(MAX_BID)}`, 'INVALID_BID');
  if (amount < minimum) throw refuse(`O lance deve ser de no mínimo ${formatMoney(minimum)}`, 'BELOW_MINIMUM');

  const bid: BidRecord = { id: nextId('bid'), auctionId, userId: user.id, amount, createdAt: now, idempotencyKey: idempotencyKey ?? null };
  // On disk before anyone is told about it (RF11)
  transaction(() => {
    bids.push(bid);
    auction.currentPrice = amount;
    auction.highestBidderId = user.id;
    auction.bidCount++;
    auction.endsAt = extendedEnd(auction, now);
  });
  return { auction: toAuction(auction), bid: toBid(bid) };
}

/**
 * RF17/RF18: records the openings and closings due at `now`, each exactly once (see jobs.ts),
 * and returns the auctions that changed.
 */
export function recordTransitions(now = Date.now()): { auction: Auction; closed: boolean }[] {
  const due: { record: AuctionRecord; opens: boolean; closes: boolean }[] = [];
  for (const record of store.auctions.values()) {
    if (record.cancelledAt !== null) continue;
    const opens = record.openedAt === null && record.startsAt <= now;
    const closes = record.closedAt === null && record.endsAt <= now;
    if (opens || closes) due.push({ record, opens, closes });
  }
  if (!due.length) return [];

  transaction(() => {
    for (const { record, opens, closes } of due) {
      if (opens) record.openedAt = now;
      if (closes) record.closedAt = now;
    }
  });
  return due.map(({ record, closes }) => ({ auction: toAuction(record), closed: closes }));
}
