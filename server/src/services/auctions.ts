import { auctionStatus, canCancel, minNextBid, type Auction, type AuctionDetail, type Bid } from '@auction/shared';
import { saveStore } from '../persistence';
import { nextId, store, type AuctionRecord, type BidRecord, type ItemRecord } from '../store';

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
    minIncrement: record.minIncrement,
    bidCount: record.bidCount,
    featured: record.featured,
    sellerId: record.sellerId,
    sellerName: store.users.get(record.sellerId)!.name,
    startsAt: new Date(record.startsAt).toISOString(),
    endsAt: new Date(record.endsAt).toISOString(),
    cancelledAt: record.cancelledAt === null ? null : new Date(record.cancelledAt).toISOString(),
  };
}

/** Scheduled or live (not cancelled, not over). */
const isActive = (record: AuctionRecord, now: number) => ['scheduled', 'live'].includes(auctionStatus(toAuction(record), now));

function toBid(record: BidRecord): Bid {
  return {
    id: record.id,
    auctionId: record.auctionId,
    amount: record.amount,
    bidderName: store.users.get(record.userId)!.name,
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

export class BidError extends Error {}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Validates and records a bid. It runs synchronously from check to write, so no
 * other bid on the same auction can slip in between.
 */
export function placeBid(auctionId: number, user: { id: number; name: string }, amount: number): { auction: Auction; bid: Bid } {
  const auction = store.auctions.get(auctionId);

  if (!auction) throw new BidError('Leilão não encontrado');
  if (auction.cancelledAt !== null) throw new BidError('Este leilão foi cancelado');
  if (auction.sellerId === user.id) throw new BidError('Você não pode dar lances no próprio leilão');
  if (auction.startsAt > Date.now()) throw new BidError('Este leilão ainda não começou');
  if (auction.endsAt <= Date.now()) throw new BidError('Este leilão já foi encerrado');
  if (auction.highestBidderId === user.id) throw new BidError('Você já tem o maior lance');

  const minimum = minNextBid(auction);
  if (amount < minimum) throw new BidError(`O lance deve ser de no mínimo ${money.format(minimum / 100)}`);

  const bid: BidRecord = { id: nextId('bid'), auctionId, userId: user.id, amount, createdAt: Date.now() };
  store.bidsByAuction.get(auctionId)!.push(bid);
  auction.currentPrice = amount;
  auction.highestBidderId = user.id;
  auction.bidCount++;
  saveStore(); // on disk before anyone is told about it

  return { auction: toAuction(auction), bid: toBid(bid) };
}
