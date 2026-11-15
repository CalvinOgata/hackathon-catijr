import { auctionStatus, MINUTE } from '@auction/shared';
import type { FastifyInstance } from 'fastify';
import { recordTransitions } from './services/auctions';
import { pruneLoginAttempts } from './services/loginAttempts';
import { isExpired } from './services/sessions';

/** Runs `job` now and every `ms` while the server is up. A failed run is logged; the next one tries again. */
function every(app: FastifyInstance, ms: number, name: string, job: () => void) {
  const run = () => {
    try {
      job();
    } catch (err) {
      app.log.error(err, `${name} failed`);
    }
  };
  run();
  const timer = setInterval(run, ms);
  app.addHook('onClose', async () => clearInterval(timer));
}

export function registerJobs(app: FastifyInstance) {
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
  every(app, 1000, 'Auction lifecycle job', () => {
    const now = Date.now();
    for (const { auction, closed } of recordTransitions(now)) {
      app.log.info({ auctionId: auction.id, status: auctionStatus(auction, now) }, closed ? 'Auction closed' : 'Auction opened');
      app.io.emit('auction:updated', auction);
    }
  });

  // Sessions can expire while a connection sits idle in a room (RF02): remove them, and their
  // connections from every room. Also forgets old wrong-password streaks.
  every(app, MINUTE, 'Session sweep', () => {
    app.endSessions((session) => isExpired(session));
    pruneLoginAttempts();
  });
}
