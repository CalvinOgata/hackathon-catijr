import {
  auctionStatus,
  calculateMinIncrement,
  canCancel,
  maskBidderName,
  minNextBid,
  type Auction,
  type AuctionDetail,
  type Bid,
  type BidFailureCode,
} from '@auction/shared';
import { saveStore } from '../persistence';
import { nextId, store, type AuctionRecord, type BidRecord, type ItemRecord } from '../store';

const RECENT_BIDS = 10;

function toAuction(record: AuctionRecord): Auction {
  const item = store.items.get(record.itemId)!;
  const highestBidder = record.highestBidderId ? store.users.get(record.highestBidderId) : null;
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
    bidCount: record.bidCount,
    featured: record.featured,
    sellerId: record.sellerId,
    sellerName: store.users.get(record.sellerId)!.name,
    startsAt: new Date(record.startsAt).toISOString(),
    endsAt: new Date(record.endsAt).toISOString(),
    cancelledAt: record.cancelledAt === null ? null : new Date(record.cancelledAt).toISOString(),
    highestBidderId: record.highestBidderId,
    highestBidderName: highestBidder ? maskBidderName(highestBidder.name) : null,
  };
}

/** Scheduled or live (not cancelled, not over). */
const isActive = (record: AuctionRecord, now: number) => ['scheduled', 'live'].includes(auctionStatus(toAuction(record), now));

function toBid(record: BidRecord): Bid {
  const user = store.users.get(record.userId);
  const fullName = user ? user.name : 'Participante';
  return {
    id: record.id,
    auctionId: record.auctionId,
    amount: record.amount,
    bidderId: record.userId,
    bidderName: maskBidderName(fullName),
    createdAt: new Date(record.createdAt).toISOString(),
  };
}

/** Lowercase without accents, so "jacaranda" finds "jacarandá". */
const searchable = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Scheduled and live auctions first (ending soonest on top), then ended and cancelled ones. */
export function listAuctions(search?: string): Auction[] {
  const now = Date.now();
  const term = search && searchable(search);
  return [...store.auctions.values()]
    .filter((a) => {
      if (!term) return true;
      const item = store.items.get(a.itemId)!;
      return [item.title, item.description, item.category].some((field) => searchable(field).includes(term));
    })
    .sort((a, b) => Number(isActive(b, now)) - Number(isActive(a, now)) || a.endsAt - b.endsAt)
    .map(toAuction);
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
  minIncrement: number;
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
    minIncrement: input.minIncrement,
    highestBidderId: null,
    bidCount: 0,
    featured: input.featured ?? false,
    startsAt: input.startsAt,
    endsAt: input.startsAt + input.durationMinutes * 60 * 1000,
    cancelledAt: null,
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
  saveStore();
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

interface IdempotencyEntry {
  result: { auction: Auction; bid: Bid };
  createdAt: number;
}

const bidIdempotency = new Map<string, IdempotencyEntry>();
const lastBidByUser = new Map<number, number>();

// Clean up idempotency cache entries older than 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, entry] of bidIdempotency.entries()) {
    if (entry.createdAt < cutoff) bidIdempotency.delete(key);
  }
}, 5 * 60 * 1000).unref();

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Validates and records a bid according to RF09 to RF14.
 * It runs synchronously from check to write, so no other bid on the same auction can slip in between (RF11).
 * Idempotency is supported via idempotencyKey (RF12).
 * Rate limit of 500ms per user is enforced without blocking retries or other users (RF13).
 */
export function placeBid(
  auctionId: number,
  user: { id: number; name: string },
  amount: number,
  idempotencyKey?: string,
): { auction: Auction; bid: Bid; isReplay?: boolean } {
  const auction = store.auctions.get(auctionId);
  if (!auction) throw new BidError('Leilão não encontrado', 0, 'INVALID_BID');

  // RF12: Idempotência do lance. Se for o mesmo lance reenviado, retorna o resultado original sem criar segundo lance.
  const trimmedKey = idempotencyKey?.trim();
  const cacheKey = trimmedKey ? `${user.id}:${auctionId}:${trimmedKey}` : undefined;
  if (cacheKey) {
    const cached = bidIdempotency.get(cacheKey);
    if (cached) {
      return { ...cached.result, isReplay: true };
    }
  }

  const now = Date.now();
  const currentAuction = toAuction(auction);
  const minimum = minNextBid(currentAuction);

  // RF10: Condições estritas no momento do processamento
  const status = auctionStatus(currentAuction, now);
  if (auction.cancelledAt !== null || status === 'cancelled') {
    throw new BidError('Este leilão foi cancelado', minimum, 'NOT_IN_PROGRESS');
  }
  if (status === 'scheduled') {
    throw new BidError('Este leilão ainda não começou', minimum, 'NOT_IN_PROGRESS');
  }
  if (status === 'sold' || status === 'unsold' || auction.endsAt <= now) {
    throw new BidError('Este leilão já foi encerrado', minimum, 'NOT_IN_PROGRESS');
  }
  if (auction.sellerId === user.id) {
    throw new BidError('Você não pode dar lances no próprio leilão', minimum, 'SELF_BID');
  }
  if (auction.highestBidderId === user.id) {
    throw new BidError('Você já tem o maior lance', minimum, 'ALREADY_LEADER');
  }

  // RF13: Limite de frequência de lances (no mínimo 500 ms entre lances de um mesmo usuário).
  // Não pune o reenvio legítimo do RF12 (que já passou acima pelo cache) e não bloqueia outros usuários.
  const lastTime = lastBidByUser.get(user.id);
  if (lastTime !== undefined && now - lastTime < 500) {
    throw new BidError('Aguarde um instante antes de enviar outro lance.', minimum, 'RATE_LIMITED');
  }

  if (amount < minimum) {
    throw new BidError(`O lance deve ser de no mínimo ${money.format(minimum / 100)}`, minimum, 'BELOW_MINIMUM');
  }

  // Registra o tempo para rate limit (RF13)
  lastBidByUser.set(user.id, now);

  // Grava o lance de verdade (RF11: concorrência e persistência garantida antes do broadcast)
  const bid: BidRecord = { id: nextId('bid'), auctionId, userId: user.id, amount, createdAt: now };
  store.bidsByAuction.get(auctionId)!.push(bid);
  auction.currentPrice = amount;
  auction.highestBidderId = user.id;
  auction.bidCount++;
  saveStore(); // gravado no disco antes de qualquer retorno

  const updatedAuction = toAuction(auction);
  const updatedBid = toBid(bid);
  const result = { auction: updatedAuction, bid: updatedBid };

  if (cacheKey) {
    bidIdempotency.set(cacheKey, { result, createdAt: now });
  }

  return result;
}
