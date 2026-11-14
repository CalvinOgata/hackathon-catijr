import type { Auction, Bid } from '@auction/shared';
import { socket } from './socket.svelte.ts';

// Several components may watch the same room (e.g. while navigating from the home
// hero to the auction page), so only leave on the server when the last one is gone.
const watchers = new Map<number, number>();

/**
 * Membership in an auction's live room. Entering requires login (RF04): only room
 * members receive bids with bidder names, and bids can only be placed from inside.
 * Always call `leave()` when done.
 */
export class AuctionRoom {
  readonly auctionId: number;
  joined = $state(false);
  error = $state<string | null>(null);
  /** Fresher than listing data: updated with every bid in the room. */
  auction = $state<Auction | null>(null);
  bids = $state<Bid[]>([]);

  #left = false;

  constructor(auctionId: number) {
    this.auctionId = auctionId;
    watchers.set(auctionId, (watchers.get(auctionId) ?? 0) + 1);
    socket.on('connect', this.#join); // the server forgets rooms when a connection drops
    socket.on('room:bid', this.#onBid);
    if (socket.connected) this.#join();
  }

  leave() {
    if (this.#left) return;
    this.#left = true;
    socket.off('connect', this.#join);
    socket.off('room:bid', this.#onBid);

    const remaining = (watchers.get(this.auctionId) ?? 1) - 1;
    if (remaining > 0) watchers.set(this.auctionId, remaining);
    else {
      watchers.delete(this.auctionId);
      if (socket.connected) socket.emit('room:leave', this.auctionId);
    }
  }

  #join = async () => {
    try {
      const result = await socket.timeout(5000).emitWithAck('room:join', this.auctionId);
      if (this.#left) return;
      if (result.ok) {
        const { recentBids, ...auction } = result.auction;
        this.auction = auction;
        this.bids = recentBids;
        this.joined = true;
        this.error = null;
      } else {
        this.joined = false;
        this.error = result.error;
      }
    } catch {
      if (!this.#left) this.error = 'Não foi possível acessar a sala do leilão. Tentaremos de novo quando a conexão voltar…';
    }
  };

  #onBid = ({ auction, bid }: { auction: Auction; bid: Bid }) => {
    if (auction.id !== this.auctionId) return;
    this.auction = auction;
    this.bids = [bid, ...this.bids].slice(0, 10);
  };
}
