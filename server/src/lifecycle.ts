import { auctionStatus, type Auction } from '@auction/shared';
import type { FastifyInstance } from 'fastify';
import { saveStore } from './persistence';
import { getAuction } from './services/auctions';
import { store } from './store';

// RF17/RF18: auctions open at their start and close at the end in force (extensions included)
// with nobody doing anything. An auction's state always follows from its times, bids and
// cancellation (`auctionStatus`), so it's right at any moment, on any server, and after any
// restart: nothing has to run for an auction to open or close, and a bid after the end is
// refused because the end is checked in the same step that records the bid (RF16).
//
// This job announces each transition when it happens (rooms and listings update right away)
// and records it in `openedAt`/`closedAt`, so it's handled exactly once: closing again finds it
// already closed. It also runs on start, so what opened or closed while the server was down is
// handled then.

const INTERVAL_MS = 1000;

/** Records the transitions due at `now` and returns the auctions that changed. */
export function runTransitions(now = Date.now()): { opened: number[]; closed: number[] } {
  const opened: number[] = [];
  const closed: number[] = [];
  for (const record of store.auctions.values()) {
    if (record.cancelledAt !== null) continue;
    if (record.openedAt === null && record.startsAt <= now) {
      record.openedAt = now;
      opened.push(record.id);
    }
    if (record.closedAt === null && record.endsAt <= now) {
      record.closedAt = now;
      closed.push(record.id);
    }
  }
  if (opened.length || closed.length) {
    try {
      saveStore();
    } catch (err) {
      // Not saved: undo the marks, so the next run tries again
      for (const id of opened) store.auctions.get(id)!.openedAt = null;
      for (const id of closed) store.auctions.get(id)!.closedAt = null;
      throw err;
    }
  }
  return { opened, closed };
}

export function registerLifecycle(app: FastifyInstance) {
  const tick = () => {
    try {
      const now = Date.now();
      const { opened, closed } = runTransitions(now);
      for (const id of new Set([...opened, ...closed])) {
        const auction = getAuction(id) as Auction;
        app.log.info({ auctionId: id, status: auctionStatus(auction, now) }, closed.includes(id) ? 'Auction closed' : 'Auction opened');
        app.io.emit('auction:updated', auction);
      }
    } catch (err) {
      app.log.error(err, 'Auction lifecycle job failed');
    }
  };

  tick();
  const timer = setInterval(tick, INTERVAL_MS);
  app.addHook('onClose', async () => clearInterval(timer));
}
