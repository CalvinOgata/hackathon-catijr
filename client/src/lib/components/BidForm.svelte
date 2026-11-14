<script lang="ts">
  import { SESSION_INVALID, type Auction } from '@auction/shared';
  import { clock } from '#lib/clock.svelte.ts';
  import { formatMoney } from '#lib/format.ts';
  import { socket } from '#lib/socket.svelte.ts';

  /** `leading`: the logged-in user has the highest bid (known from the room). */
  let { auction, leading }: { auction: Auction; leading: boolean } = $props();

  // Computed by the server (RF14); this form only displays it
  const minimum = $derived(auction.minBid);
  const increment = $derived(auction.minIncrement);
  const ended = $derived(Date.parse(auction.endsAt) <= clock.now);

  /** In reais, as typed by the user. */
  let amount = $state<number | null>(null);
  let submitting = $state(false);
  let cooldown = $state(false);
  let feedback = $state<{ kind: 'error' | 'success'; text: string } | null>(null);

  // Suggest the minimum, and bump the amount up when someone else outbids
  $effect(() => {
    if (amount === null || amount * 100 < minimum) amount = minimum / 100;
  });

  const quickIncrements = $derived([1, 5, 10].map((times) => times * increment));

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
    if (amount === null || submitting || cooldown || leading) return;

    submitting = true;
    feedback = null;
    const cents = Math.round(amount * 100);

    try {
      const result = await socket.timeout(5000).emitWithAck('bid:place', {
        auctionId: auction.id,
        amount: cents,
        idempotencyKey: keyFor(cents),
      });

      if (result.ok) {
        settle();
        feedback = { kind: 'success', text: 'Lance registrado! Você está na liderança.' };
      } else {
        // A refusal is definitive; a server error or an expired session isn't (the bid may be retried)
        if (result.code && result.code !== SESSION_INVALID) settle();
        // RF10: every refusal tells the reason and the current minimum
        let msg = result.error;
        if (result.currentMinBid && result.currentMinBid > 0) {
          amount = result.currentMinBid / 100;
          msg += ` (Mínimo: ${formatMoney(result.currentMinBid)})`;
        }
        feedback = { kind: 'error', text: msg };
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
  <form onsubmit={submit}>
    <label for="bid-amount" class="label">
      Seu lance <span class="muted">· mín. {formatMoney(minimum)} (+{formatMoney(increment)} mín.)</span>
    </label>
    <div class="amount">
      <span class="currency">R$</span>
      <input id="bid-amount" class="input" type="number" inputmode="decimal" step="0.01" min={minimum / 100} required bind:value={amount} />
    </div>

    <div class="quick" aria-label="Incrementos rápidos de lance">
      {#each quickIncrements as inc (inc)}
        <button type="button" onclick={() => (amount = (amount ?? minimum / 100) + inc / 100)}>+{formatMoney(inc)}</button>
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
    font-size: 18px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
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
