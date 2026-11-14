import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config';
import { bidKey, restoreIds, store, type AuctionRecord, type BidRecord, type ItemRecord, type SessionRecord, type UserRecord } from './store';

// The store is saved as one JSON file on the VM's disk (managers' rule: no database, no cloud).
//
// Every change is saved right away, synchronously, before the request answers or an event is
// broadcast: whatever anyone has seen is already on disk. The file is written to a temporary
// path, flushed and then renamed over the old one, so a crash mid-write never leaves a
// half-written file behind. Rewriting the whole file each time is simple and fast enough at
// this scale; an append-only log would be the next step if it ever gets too big.
//
// Login attempt streaks aren't saved: they're short-lived and only slow down guessing.

const FILE = join(config.dataDir, 'store.json');
const VERSION = 1;

interface Snapshot {
  version: number;
  users: UserRecord[];
  items: ItemRecord[];
  auctions: AuctionRecord[];
  bids: BidRecord[];
  sessions: SessionRecord[];
}

const maxId = (records: { id: number }[]) => records.reduce((max, r) => Math.max(max, r.id), 0);

/** Fills the store from disk. Returns false when there's no saved data yet (first start). */
export function loadStore(): boolean {
  if (!existsSync(FILE)) return false;

  const data = JSON.parse(readFileSync(FILE, 'utf8')) as Snapshot;
  if (data.version !== VERSION) throw new Error(`Unsupported ${FILE} version ${data.version}`);

  for (const user of data.users) {
    user.deletedAt ??= null; // saved before accounts could be deleted
    store.users.set(user.id, user);
    if (user.deletedAt === null) store.userIdsByEmail.set(user.email, user.id);
  }
  for (const item of data.items) store.items.set(item.id, item);
  for (const auction of data.auctions) {
    auction.cancelledAt ??= null; // saved before cancelling existed
    delete (auction as { minIncrement?: number }).minIncrement; // sellers used to choose it; now it's the RF14 table
    store.auctions.set(auction.id, auction);
    store.bidsByAuction.set(auction.id, []);
  }
  for (const bid of data.bids.sort((a, b) => a.id - b.id)) {
    bid.idempotencyKey ??= null; // saved before bids had one
    store.bidsByAuction.get(bid.auctionId)!.push(bid);
    if (bid.idempotencyKey !== null) store.bidsByKey.set(bidKey(bid.userId, bid.auctionId, bid.idempotencyKey), bid);
  }
  for (const session of data.sessions) {
    store.sessions.set(session.id, session);
    store.sessionIdsByTokenHash.set(session.tokenHash, session.id);
  }

  restoreIds({
    user: maxId(data.users),
    item: maxId(data.items),
    auction: maxId(data.auctions),
    bid: maxId(data.bids),
    session: maxId(data.sessions),
  });
  return true;
}

/** Writes the whole store to disk. Call it after every change, before answering. */
export function saveStore() {
  const snapshot: Snapshot = {
    version: VERSION,
    users: [...store.users.values()],
    items: [...store.items.values()],
    auctions: [...store.auctions.values()],
    bids: [...store.bidsByAuction.values()].flat(),
    sessions: [...store.sessions.values()],
  };

  mkdirSync(config.dataDir, { recursive: true });
  const temp = `${FILE}.tmp`;
  const fd = openSync(temp, 'w');
  try {
    writeSync(fd, JSON.stringify(snapshot));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, FILE);
}
