import type { Auction, Bid, RoomMode, RoomPresence } from '@auction/shared';
import { socket } from './socket.svelte.ts';

// Several components may watch the same room (e.g. while navigating from the home
// hero to the auction page), so only leave on the server when the last one is gone.
const watchers = new Map<number, number>();
/**
 * This connection's role in each room (RF25), shared by every component watching it, and used
 * to rejoin with the same role after reconnecting. Spectator until upgraded.
 */
const modes = $state<Record<number, RoomMode>>({});

/**
 * Membership in an auction's live room. Entering requires login (RF04): only room
 * members receive bids with bidder names, and bids can only be placed from inside.
 *
 * RF25: users enter as spectators; `upgrade()` makes them participants (who can bid).
 * Always call `leave()` when done.
 */
export class AuctionRoom {
  readonly auctionId: number;
  joined = $state(false);
  error = $state<string | null>(null);
  /** Fresher than listing data: updated with every bid in the room. */
  auction = $state<Auction | null>(null);
  /** Newest first. The newest bid is always the leader's: every accepted bid takes the lead. */
  bids = $state<Bid[]>([]);
  /** The `bidderTag` of the logged-in user's bids in this auction (RF09: bidders aren't identified by id). */
  viewerTag = $state<string | null>(null);

  /** RF25: people in the room who can bid, and people only watching. Updated via room:presence. */
  participants = $state(0);
  spectators = $state(0);

  #left = false;

  constructor(auctionId: number) {
    this.auctionId = auctionId;
    watchers.set(auctionId, (watchers.get(auctionId) ?? 0) + 1);
    socket.on('connect', this.#join); // the server forgets rooms when a connection drops
    socket.on('room:bid', this.#onBid);
    socket.on('auction:updated', this.#onUpdated); // status changes without a bid, e.g. cancelled (RF08)
    socket.on('room:presence', this.#onPresence); // RF25: headcount updates
    if (socket.connected) this.#join();
  }

  leave() {
    if (this.#left) return;
    this.#left = true;
    socket.off('connect', this.#join);
    socket.off('room:bid', this.#onBid);
    socket.off('auction:updated', this.#onUpdated);
    socket.off('room:presence', this.#onPresence);

    const remaining = (watchers.get(this.auctionId) ?? 1) - 1;
    if (remaining > 0) watchers.set(this.auctionId, remaining);
    else {
      watchers.delete(this.auctionId);
      delete modes[this.auctionId];
      if (socket.connected) socket.emit('room:leave', this.auctionId);
    }
  }

  /**
   * RF25: 'spectator' receives bids and the headcount but can't bid; 'participant' can bid.
   * A seller is always a spectator in their own auction.
   */
  get mode(): RoomMode {
    return modes[this.auctionId] ?? 'spectator';
  }

  /**
   * RF25: makes this connection a participant without leaving the room.
   * Returns null when done, or why it couldn't be done (the room itself stays as it was).
   */
  async upgrade(): Promise<string | null> {
    if (this.mode === 'participant') return null;
    if (this.#left) return 'Você saiu da sala do leilão.';
    try {
      const result = await socket.timeout(5000).emitWithAck('room:upgrade', this.auctionId);
      if (!result.ok) return result.error;
      if (this.#left) return null;
      const { recentBids, ...auction } = result.auction;
      this.auction = auction;
      this.bids = recentBids;
      this.viewerTag = result.viewerTag;
      modes[this.auctionId] = result.mode;
      return null;
    } catch {
      return 'Não foi possível entrar como participante. Tente novamente.';
    }
  }

  #join = async () => {
    try {
      // RF25: spectator at first; after reconnecting, the role this connection had
      const result = await socket.timeout(5000).emitWithAck('room:join', this.auctionId, this.mode);
      if (this.#left) return;
      if (result.ok) {
        const { recentBids, ...auction } = result.auction;
        this.auction = auction;
        this.bids = recentBids;
        modes[this.auctionId] = result.mode;
        this.viewerTag = result.viewerTag;
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

  /** The current leader's latest bid, or null without bids (or before joining). */
  get leader(): Bid | null {
    return this.auction?.bidCount ? (this.bids[0] ?? null) : null;
  }

  isMine(bid: Bid | null): boolean {
    return bid !== null && bid.bidderTag === this.viewerTag;
  }

  #onUpdated = (auction: Auction) => {
    if (auction.id === this.auctionId && this.auction) this.auction = auction;
  };

  #onBid = ({ auction, bid }: { auction: Auction; bid: Bid }) => {
    if (auction.id !== this.auctionId) return;
    this.auction = auction;
    this.bids = [bid, ...this.bids].slice(0, 10);
  };

  #onPresence = ({ auctionId, participants, spectators }: RoomPresence) => {
    if (auctionId !== this.auctionId) return;
    this.participants = participants;
    this.spectators = spectators;
  };
}
