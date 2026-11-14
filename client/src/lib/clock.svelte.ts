import { socket } from './socket.svelte.ts';

// The server's clock is the one that counts (RF16). The browser's may be minutes off, so every
// countdown and status on screen runs on the server's time: the browser's clock corrected by the
// difference measured with `clock:sync`. It's only visual; the server decides what's accepted.

const SAMPLES = 5;
const RESYNC_MS = 10 * 60 * 1000;

/** Server time minus browser time, in ms. Zero until the first sync. */
let offset = 0;

/** The server's current time, as best known (epoch ms). Not reactive: use `clock.now` in templates. */
export const serverNow = () => Date.now() + offset;

/** A single ticking clock shared by every countdown on the page. */
export const clock = $state({ now: Date.now() });

setInterval(() => (clock.now = serverNow()), 1000);

/**
 * Asks the server for its time a few times and keeps the quickest answer: with the shortest
 * round trip, assuming the server answered halfway through is the least wrong.
 */
async function sync() {
  let best: { roundTrip: number; offset: number } | null = null;
  for (let i = 0; i < SAMPLES; i++) {
    const sent = performance.now();
    let serverTime: number;
    try {
      serverTime = await socket.timeout(5000).emitWithAck('clock:sync');
    } catch {
      return; // Disconnected; it runs again on the next connect
    }
    const roundTrip = performance.now() - sent;
    const sample = serverTime + roundTrip / 2 - Date.now();
    if (!best || roundTrip < best.roundTrip) best = { roundTrip, offset: sample };
  }
  offset = best!.offset;
  clock.now = serverNow();
}

socket.on('connect', sync);
// Clocks drift, and the browser's can be changed while the page is open
setInterval(() => socket.connected && sync(), RESYNC_MS);
