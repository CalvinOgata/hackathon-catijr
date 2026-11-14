/** Briefly highlights a value in green; used when a new bid updates a price. */
export function flash(_node: Element, { duration = 1200 } = {}) {
  return {
    duration,
    css: (t: number) => {
      const amount = Math.round((1 - t) * 100);
      return `
        background-color: color-mix(in srgb, var(--green-soft) ${amount}%, transparent);
        color: color-mix(in srgb, var(--green) ${amount}%, var(--text));
      `;
    },
  };
}
