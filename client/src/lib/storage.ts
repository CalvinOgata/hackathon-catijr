// localStorage/sessionStorage can be unavailable (private mode, blocked site data): then nothing
// is kept between page loads, and everything still works while the page stays open.

/** The JSON value saved under `key`, or null. */
export function readStored<T>(storage: 'local' | 'session', key: string): T | null {
  try {
    return JSON.parse((storage === 'local' ? localStorage : sessionStorage).getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/** Saves `value` as JSON under `key`; null removes it. */
export function writeStored(storage: 'local' | 'session', key: string, value: unknown) {
  try {
    const store = storage === 'local' ? localStorage : sessionStorage;
    if (value === null) store.removeItem(key);
    else store.setItem(key, JSON.stringify(value));
  } catch {
    // Unavailable: see above
  }
}
