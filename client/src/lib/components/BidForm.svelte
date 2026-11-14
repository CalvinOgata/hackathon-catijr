<script lang="ts">
  import { MAX_BID, SESSION_INVALID, type Auction } from '@auction/shared';
  import { untrack } from 'svelte';
  import { clock } from '#lib/clock.svelte.ts';
  import { formatMoney } from '#lib/format.ts';
  import { socket } from '#lib/socket.svelte.ts';

  /** `leading`: the logged-in user has the highest bid (known from the room). */
  let { auction, leading }: { auction: Auction; leading: boolean } = $props();

  // Computed by the server (RF14); this form only displays it
  const minimum = $derived(auction.minBid);
  const increment = $derived(auction.minIncrement);
  const ended = $derived(Date.parse(auction.endsAt) <= clock.now);

  /** In reais, as typed by the user (null or undefined while the field is empty). */
  let amount = $state<number | null | undefined>(null);
  /** Once the user changes the amount, it's theirs: it no longer follows the minimum. */
  let edited = false;
  /** Problems with the amount are only pointed out after trying to send it. */
  let attempted = $state(false);
  let submitting = $state(false);
  let cooldown = $state(false);
  /** The server's answer to the last bid. */
  let feedback = $state<{ kind: 'error' | 'success'; text: string } | null>(null);

  // Suggest the minimum, and keep following it (e.g. when someone else outbids) until the user edits it
  $effect(() => {
    const min = minimum;
    untrack(() => {
      if (!edited) amount = min / 100;
    });
  });

  const cents = (reais: number) => Math.round(reais * 100);

  const belowMinimumProblem = $derived(`o lance mínimo agora é ${formatMoney(minimum)}.`);

  /** Why the amount can't be sent, or null. The server checks it again (RF10). */
  function amountProblem(value: number | null | undefined): string | null {
    if (value == null || !Number.isFinite(value)) return 'digite o valor do seu lance.';
    if (value <= 0) return 'o valor deve ser maior que zero.';
    if (Math.abs(value * 100 - cents(value)) > 1e-6) return 'use no máximo duas casas decimais (centavos).';
    if (cents(value) > MAX_BID) return `o lance pode ser de no máximo ${formatMoney(MAX_BID)}.`;
    if (cents(value) < minimum) return belowMinimumProblem;
    return null;
  }

  const problem = $derived(amountProblem(amount));

  function setAmount(value: number) {
    amount = Math.max(0, value) / 100;
    edited = true;
    feedback = null;
  }

  function onInput() {
    edited = true;
    feedback = null;
  }

  const quickIncrements = $derived([1, 5, 10].map((times) => times * increment));

  // Arrows: each step is the current increment, and it doubles every few steps while the arrow is
  // held down, clicked in quick succession or the arrow key is kept pressed, so big changes are fast
  const HOLD_DELAY_MS = 400;
  const REPEAT_MS = 100;
  /** Clicks closer together than this keep accelerating. */
  const STREAK_MS = 600;
  const STEPS_PER_DOUBLING = 4;
  const MAX_DOUBLINGS = 10;

  let streak = { direction: 0, steps: 0, at: 0 };
  let holdTimer: ReturnType<typeof setTimeout> | undefined;

  function nudge(direction: 1 | -1) {
    const now = performance.now();
    if (direction !== streak.direction || now - streak.at > STREAK_MS) streak = { direction, steps: 0, at: now };
    const step = increment * 2 ** Math.min(Math.floor(streak.steps / STEPS_PER_DOUBLING), MAX_DOUBLINGS);
    streak.steps++;
    streak.at = now;

    const current = amount != null && Number.isFinite(amount) ? cents(amount) : minimum;
    let next = Math.min(current + direction * step, MAX_BID);
    // Going down stops at the minimum (a lower amount can still be typed)
    if (direction < 0) next = Math.max(next, Math.min(current, minimum));
    setAmount(next);
  }

  function startHold(event: PointerEvent, direction: 1 | -1) {
    if (event.button !== 0) return;
    event.preventDefault(); // keeps the focus where it is
    stopHold();
    nudge(direction);
    holdTimer = setTimeout(function repeat() {
      nudge(direction);
      holdTimer = setTimeout(repeat, REPEAT_MS);
    }, HOLD_DELAY_MS);
  }

  function stopHold() {
    clearTimeout(holdTimer);
    holdTimer = undefined;
  }

  // Pointer presses are handled by startHold; this only handles the keyboard (Enter/Space)
  function onArrowClick(event: MouseEvent, direction: 1 | -1) {
    if (event.detail === 0) nudge(direction);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault(); // instead of the browser's one-cent steps
    nudge(event.key === 'ArrowUp' ? 1 : -1);
  }

  $effect(() => stopHold);

  // RF12: each bid intent (auction + amount) gets one key. When a send gets no definitive
  // answer (timeout, dropped connection, server error, expired session), sending the same
  // amount again reuses the key, so if the first one did go through the server returns it
  // instead of creating a second bid. It's kept in sessionStorage to survive logging in again.
  type Pending = { key: string; amount: number };
  const storageKey = () => `bid-pending:${auction.id}`;

  function newKey(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // randomUUID only exists on HTTPS or localhost; getRandomValues works everywhere
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function readPending(): Pending | null {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey()) ?? 'null');
    } catch {
      return null;
    }
  }

  function writePending(pending: Pending | null) {
    try {
      if (pending) sessionStorage.setItem(storageKey(), JSON.stringify(pending));
      else sessionStorage.removeItem(storageKey());
    } catch {
      // Storage unavailable (private mode): retries still work while the page stays open
    }
  }

  let pending: Pending | null = readPending();

  function keyFor(cents: number): string {
    if (pending?.amount !== cents) {
      pending = { key: newKey(), amount: cents };
      writePending(pending);
    }
    return pending.key;
  }

  function settle() {
    pending = null;
    writePending(null);
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting || cooldown || leading) return;
    feedback = null;
    if (problem || amount == null) {
      attempted = true;
      return;
    }

    submitting = true;
    const bidCents = cents(amount);

    try {
      const result = await socket.timeout(5000).emitWithAck('bid:place', {
        auctionId: auction.id,
        amount: bidCents,
        idempotencyKey: keyFor(bidCents),
      });

      if (result.ok) {
        settle();
        attempted = false;
        edited = false; // back to suggesting the minimum when outbid
        feedback = { kind: 'success', text: 'Lance registrado! Você está na liderança.' };
      } else {
        // A refusal is definitive; a server error or an expired session isn't (the bid may be retried)
        if (result.code && result.code !== SESSION_INVALID) settle();
        // RF10: every refusal tells the reason and the current minimum. The amount typed is kept.
        let text = `Lance recusado: ${result.error.replace(/\.$/, '')}.`;
        if (result.currentMinBid && result.code !== 'BELOW_MINIMUM') text += ` Lance mínimo atual: ${formatMoney(result.currentMinBid)}.`;
        feedback = { kind: 'error', text };
      }
    } catch {
      feedback = { kind: 'error', text: 'O servidor não respondeu. Tente novamente.' };
    } finally {
      submitting = false;
      // RF13: matches the server's 500 ms between bids, so a double click doesn't get refused
      cooldown = true;
      setTimeout(() => (cooldown = false), 500);
    }
  }
</script>

{#if ended}
  <p class="closed">Este leilão foi encerrado.</p>
{:else if leading}
  <div class="leader-box" role="status">
    <div class="leader-header">
      <span class="leader-star">⭐</span>
      <strong>Você é o líder atual deste leilão!</strong>
    </div>
    <p class="muted small">Seu lance de {formatMoney(auction.currentPrice)} é o maior no momento. Você não pode dar lances contra si mesmo.</p>
  </div>
{:else}
  <form onsubmit={submit} novalidate>
    <label for="bid-amount" class="label">
      Seu lance <span class="muted">· mín. {formatMoney(minimum)} (+{formatMoney(increment)} mín.)</span>
    </label>
    <div class="amount">
      <span class="currency">R$</span>
      <input
        id="bid-amount"
        class="input"
        type="number"
        inputmode="decimal"
        step="0.01"
        aria-invalid={attempted && !!problem}
        aria-describedby="bid-problem"
        bind:value={amount}
        oninput={onInput}
        onkeydown={onKeydown}
      />
      <div class="stepper">
        <button
          type="button"
          aria-label="Aumentar o lance"
          onpointerdown={(e) => startHold(e, 1)}
          onpointerup={stopHold}
          onpointerleave={stopHold}
          onpointercancel={stopHold}
          oncontextmenu={(e) => e.preventDefault()}
          onclick={(e) => onArrowClick(e, 1)}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5 6 4l3.5 3.5" /></svg>
        </button>
        <button
          type="button"
          aria-label="Diminuir o lance"
          onpointerdown={(e) => startHold(e, -1)}
          onpointerup={stopHold}
          onpointerleave={stopHold}
          onpointercancel={stopHold}
          oncontextmenu={(e) => e.preventDefault()}
          onclick={(e) => onArrowClick(e, -1)}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
        </button>
      </div>
    </div>
    {#if attempted && problem}
      <p id="bid-problem" class="problem field-error" role="alert">
        <strong>Lance inválido:</strong> {problem}
        {#if problem === belowMinimumProblem}
          <button type="button" class="link" onclick={() => setAmount(minimum)}>Usar o mínimo</button>
        {/if}
      </p>
    {/if}

    <div class="quick" aria-label="Incrementos rápidos de lance">
      {#each quickIncrements as inc (inc)}
        <button type="button" onclick={() => setAmount((amount != null && Number.isFinite(amount) ? cents(amount) : minimum) + inc)}>+{formatMoney(inc)}</button>
      {/each}
    </div>

    <button class="btn btn-primary full" disabled={submitting || cooldown}>
      {submitting ? 'Enviando lance…' : 'Dar lance'}
    </button>

    {#if feedback}
      <p class="alert alert-{feedback.kind}" role="status">{feedback.text}</p>
    {/if}
  </form>
{/if}

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .label {
    font-size: 13px;
    font-weight: 600;
  }

  .amount {
    position: relative;
  }

  .currency {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--muted);
    font-weight: 600;
  }

  .amount .input {
    padding-left: 44px;
    padding-right: 44px;
    font-size: 18px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    appearance: textfield;
    -moz-appearance: textfield;
  }

  /* The browser's own arrows step one cent at a time; ours are below */
  .amount .input::-webkit-outer-spin-button,
  .amount .input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .stepper {
    position: absolute;
    top: 4px;
    right: 4px;
    bottom: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .stepper button {
    flex: 1;
    display: grid;
    place-items: center;
    width: 32px;
    padding: 0;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }

  .stepper button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .stepper svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .problem {
    margin: -4px 0 0;
    font-weight: 400;
  }

  .link {
    padding: 0;
    margin-left: 4px;
    background: none;
    border: none;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    cursor: pointer;
  }

  .quick {
    display: flex;
    gap: 6px;
  }

  .quick button {
    flex: 1;
    height: 32px;
    padding: 0 6px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .quick button:hover {
    border-color: var(--accent);
  }

  .full {
    width: 100%;
    height: 46px;
  }

  .closed {
    padding: 14px;
    text-align: center;
    background: var(--surface-2);
    border-radius: 10px;
    color: var(--muted);
    font-weight: 600;
  }

  .leader-box {
    padding: 14px 16px;
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
    border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .leader-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--text);
  }

  .leader-star {
    font-size: 16px;
  }
</style>
