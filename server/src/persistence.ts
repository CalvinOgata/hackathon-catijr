import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config';
import { restoreIds, store, type AuctionRecord, type BidRecord, type ItemRecord, type SessionRecord, type UserRecord } from './store';

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

/** The store as last written to disk; a failed save goes back to it. */
let saved: string | null = null;

const maxId = (records: { id: number }[]) => records.reduce((max, r) => Math.max(max, r.id), 0);

/** Replaces the store's contents (and its indexes) with a saved snapshot, or empties it. */
function hydrate(json: string | null) {
  const data: Snapshot = json ? JSON.parse(json) : { version: VERSION, users: [], items: [], auctions: [], bids: [], sessions: [] };
  if (data.version !== VERSION) {
    throw new Error(`${FILE} was saved by another version of the app. Run "make reset-data" to start over with the sample data.`);
  }

  for (const map of [store.users, store.userIdsByEmail, store.items, store.auctions, store.bidsByAuction, store.sessions, store.sessionIdsByTokenHash]) {
    map.clear();
  }
  for (const user of data.users) {
    store.users.set(user.id, user);
    if (user.deletedAt === null) store.userIdsByEmail.set(user.email, user.id);
  }
  for (const item of data.items) store.items.set(item.id, item);
  for (const auction of data.auctions) {
    store.auctions.set(auction.id, auction);
    store.bidsByAuction.set(auction.id, []);
  }
  for (const bid of data.bids.sort((a, b) => a.id - b.id)) store.bidsByAuction.get(bid.auctionId)!.push(bid);
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
  saved = json;
}

/** Fills the store from disk. Returns false when there's no saved data yet (first start). */
export function loadStore(): boolean {
  if (!existsSync(FILE)) return false;
  hydrate(readFileSync(FILE, 'utf8'));
  return true;
}

function write(json: string) {
  mkdirSync(config.dataDir, { recursive: true });
  const temp = `${FILE}.tmp`;
  const fd = openSync(temp, 'w');
  try {
    writeSync(fd, json);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, FILE);
}

/**
 * Applies a change to the store and saves it to disk, before anyone is told about it. If saving
 * fails, the store goes back to what is on disk and the error is thrown: an unsaved change never
 * stays in memory, where it would be saved silently with the next one.
 *
 * Every write goes through here. `change` should only write: run the checks before, so a refusal
 * doesn't cost a save.
 */
export function transaction<T>(change: () => T): T {
  const result = change();
  const json = JSON.stringify({
    version: VERSION,
    users: [...store.users.values()],
    items: [...store.items.values()],
    auctions: [...store.auctions.values()],
    bids: [...store.bidsByAuction.values()].flat(),
    sessions: [...store.sessions.values()],
  } satisfies Snapshot);
  try {
    write(json);
  } catch (err) {
    hydrate(saved);
    throw err;
  }
  saved = json;
  return result;
}
