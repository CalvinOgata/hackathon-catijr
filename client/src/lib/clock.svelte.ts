/** A single ticking clock shared by every countdown on the page. */
export const clock = $state({ now: Date.now() });

setInterval(() => (clock.now = Date.now()), 1000);
