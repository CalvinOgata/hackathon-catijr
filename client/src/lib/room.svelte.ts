import type { Auction, Bid, RoomMode, RoomPresence } from '@auction/shared';
import { untrack } from 'svelte';
import { listen, socket } from './socket.svelte.ts';

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
  /** Only the latest join attempt counts: an older one may time out after a newer one worked. */
  #attempt = 0;
  #unsubscribe: (() => void)[];

  constructor(auctionId: number) {
    this.auctionId = auctionId;
    watchers.set(auctionId, (watchers.get(auctionId) ?? 0) + 1);
    this.#unsubscribe = [
      listen('connect', this.#join), // the server forgets rooms when a connection drops
      listen('room:bid', this.#onBid),
      listen('auction:updated', this.#onUpdated), // status changes without a bid, e.g. cancelled (RF08)
      listen('room:presence', this.#onPresence), // RF25: headcount updates
    ];
    // Rooms are usually created inside an $effect: joining reads shared state (`modes`), which
    // must not become a dependency of that effect, or every answer would recreate the room.
    if (socket.connected) untrack(this.#join);
  }

  leave() {
    if (this.#left) return;
    this.#left = true;
    this.#unsubscribe.forEach((unsubscribe) => unsubscribe());

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
   * RF25: makes this connection a participant without leaving the room (joining again with the
   * new role). Returns null when done, or why it couldn't be done (the room stays as it was).
   */
  async upgrade(): Promise<string | null> {
    if (this.mode === 'participant') return null;
    try {
      const refused = await this.#enter('participant');
      if (refused) return refused;
      return modes[this.auctionId] === 'participant' ? null : 'Você não pode participar do próprio leilão, só assistir';
    } catch {
      return 'Não foi possível entrar como participante. Tente novamente.';
    }
  }

  /** Joins with `mode` and takes in the room's state. Returns why the server refused, or null. Throws when it doesn't answer. */
  async #enter(mode: RoomMode): Promise<string | null> {
    const result = await socket.timeout(5000).emitWithAck('room:join', this.auctionId, mode);
    if (!result.ok) return result.error;
    if (this.#left) return null;
    const { recentBids, ...auction } = result.auction;
    this.auction = auction;
    this.bids = recentBids;
    this.viewerTag = result.viewerTag;
    modes[this.auctionId] = result.mode;
    this.joined = true;
    return null;
  }

  // RF25: spectator at first; after reconnecting, the role this connection had
  #join = async () => {
    const attempt = ++this.#attempt;
    let error: string | null;
    try {
      error = await this.#enter(this.mode);
    } catch {
      error = 'Não foi possível acessar a sala do leilão. Tentaremos de novo quando a conexão voltar…';
    }
    if (!this.#left && attempt === this.#attempt) this.error = error;
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
