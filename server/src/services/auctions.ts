import { minNextBid, type Auction, type AuctionDetail, type Bid, type CreateAuctionInput } from '@auction/shared';
import { nextId, store, type AuctionRecord, type BidRecord } from '../store';

const RECENT_BIDS = 10;

function toAuction(record: AuctionRecord): Auction {
  const { highestBidderId: _, createdAt: __, endsAt, ...rest } = record;
  return { ...rest, sellerName: store.users.get(record.sellerId)!.name, endsAt: new Date(endsAt).toISOString() };
}

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

/** Live auctions first (ending soonest on top), then the ones that already ended. */
export function listAuctions(search?: string): Auction[] {
  const now = Date.now();
  const term = search && searchable(search);
  return [...store.auctions.values()]
    .filter((a) => !term || [a.title, a.description, a.category].some((field) => searchable(field).includes(term)))
    .sort((a, b) => Number(a.endsAt <= now) - Number(b.endsAt <= now) || a.endsAt - b.endsAt)
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

export function createAuction(
  sellerId: number,
  input: CreateAuctionInput & { featured?: boolean; endsAt?: number },
): Auction {
  const now = Date.now();
  const record: AuctionRecord = {
    id: nextId('auction'),
    title: input.title,
    description: input.description,
    imageUrl: input.imageUrl ?? '',
    category: input.category,
    startingPrice: input.startingPrice,
    currentPrice: input.startingPrice,
    minIncrement: input.minIncrement,
    highestBidderId: null,
    bidCount: 0,
    featured: input.featured ?? false,
    sellerId,
    endsAt: input.endsAt ?? now + input.durationMinutes * 60 * 1000,
    createdAt: now,
  };
  store.auctions.set(record.id, record);
  store.bidsByAuction.set(record.id, []);
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
  if (auction.sellerId === user.id) throw new BidError('Você não pode dar lances no próprio leilão');
  if (auction.endsAt <= Date.now()) throw new BidError('Este leilão já foi encerrado');
  if (auction.highestBidderId === user.id) throw new BidError('Você já tem o maior lance');

  const minimum = minNextBid(auction);
  if (amount < minimum) throw new BidError(`O lance deve ser de no mínimo ${money.format(minimum / 100)}`);

  const bid: BidRecord = { id: nextId('bid'), auctionId, userId: user.id, amount, createdAt: Date.now() };
  store.bidsByAuction.get(auctionId)!.push(bid);
  auction.currentPrice = amount;
  auction.highestBidderId = user.id;
  auction.bidCount++;

  return { auction: toAuction(auction), bid: toBid(bid) };
}
