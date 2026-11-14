import type { Auction, Bid, RoomMode, RoomPresence } from '@auction/shared';
import { socket } from './socket.svelte.ts';

// Several components may watch the same room (e.g. while navigating from the home
// hero to the auction page), so only leave on the server when the last one is gone.
const watchers = new Map<number, number>();

/**
 * Membership in an auction's live room. Entering requires login (RF04): only room
 * members receive bids with bidder names, and bids can only be placed from inside.
 *
 * RF25: users always enter as spectators; call `upgrade()` to become a participant.
 * Always call `leave()` when done.
 */
export class AuctionRoom {
  readonly auctionId: number;
  joined = $state(false);
  error = $state<string | null>(null);
  /** Fresher than listing data: updated with every bid in the room. */
  auction = $state<Auction | null>(null);
  bids = $state<Bid[]>([]);

  /**
   * RF25: role of this connection in the room.
   * - 'spectator': can receive bids and presence updates, but cannot place bids.
   * - 'participant': full access, including bid placement.
   * Starts as spectator on every join; call upgrade() to become a participant.
   */
  mode = $state<RoomMode>('spectator');
  /** RF25: number of connections in the participant room right now. Updated via room:presence. */
  participants = $state(0);
  /** RF25: number of connections in the spectator room right now. Updated via room:presence. */
  spectators = $state(0);

  #left = false;
  #upgrading = false;

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
      if (socket.connected) socket.emit('room:leave', this.auctionId);
    }
  }

  /**
   * RF25: promote this connection from spectator to participant without leaving the room.
   * - No-op (returns true) if already a participant.
   * - Guards against concurrent calls with #upgrading.
   * - On success: updates mode, auction snapshot and bids.
   * - On failure: sets this.error and returns false.
   */
  async upgrade(): Promise<boolean> {
    if (this.mode === 'participant' || this.#upgrading || this.#left) return this.mode === 'participant';
    this.#upgrading = true;
    try {
      const result = await socket.timeout(5000).emitWithAck('room:upgrade', this.auctionId);
      if (this.#left) return false;
      if (result.ok) {
        const { recentBids, ...auction } = result.auction;
        this.auction = auction;
        this.bids = recentBids;
        this.mode = 'participant';
        this.error = null;
        return true;
      } else {
        this.error = result.error;
        return false;
      }
    } catch {
      if (!this.#left) this.error = 'Não foi possível entrar como participante. Tente novamente.';
      return false;
    } finally {
      this.#upgrading = false;
    }
  }

  #join = async () => {
    try {
      // RF25: always enter as spectator; the user can upgrade explicitly.
      const result = await socket.timeout(5000).emitWithAck('room:join', this.auctionId, 'spectator');
      if (this.#left) return;
      if (result.ok) {
        const { recentBids, ...auction } = result.auction;
        this.auction = auction;
        this.bids = recentBids;
        this.mode = result.mode;
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
