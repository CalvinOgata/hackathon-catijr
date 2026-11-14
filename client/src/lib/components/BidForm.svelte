<script lang="ts">
  import { calculateMinIncrement, minNextBid, type Auction } from '@auction/shared';
  import { auth } from '#lib/auth.svelte.ts';
  import { clock } from '#lib/clock.svelte.ts';
  import { formatMoney } from '#lib/format.ts';
  import { socket } from '#lib/socket.svelte.ts';

  let { auction }: { auction: Auction } = $props();

  const minimum = $derived(minNextBid(auction));
  const ended = $derived(Date.parse(auction.endsAt) <= clock.now);
  const isLeader = $derived(auth.user?.id !== undefined && auth.user?.id === auction.highestBidderId);

  /** In reais, as typed by the user. */
  let amount = $state<number | null>(null);
  let submitting = $state(false);
  let cooldown = $state(false);
  let feedback = $state<{ kind: 'error' | 'success'; text: string } | null>(null);

  // Suggest the minimum, and bump the amount up when someone else outbids
  $effect(() => {
    if (amount === null || amount * 100 < minimum) amount = minimum / 100;
  });

  const increment = $derived(calculateMinIncrement(auction.currentPrice));
  const quickIncrements = $derived([1, 5, 10].map((times) => times * increment));

  function generateIdempotencyKey(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (amount === null || submitting || cooldown || isLeader) return;

    submitting = true;
    feedback = null;
    const idempotencyKey = generateIdempotencyKey();

    try {
      const result = await socket.timeout(5000).emitWithAck('bid:place', {
        auctionId: auction.id,
        amount: Math.round(amount * 100),
        idempotencyKey,
      });

      if (result.ok) {
        feedback = { kind: 'success', text: 'Lance registrado! Você está na liderança.' };
        if (result.auction) {
          amount = minNextBid(result.auction) / 100;
        }
      } else {
        // RF10: Todo lance recusado informa ao autor o motivo e o lance mínimo atual
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
      // RF13: Cooldown visual suave de 500ms para evitar rajadas
      cooldown = true;
      setTimeout(() => (cooldown = false), 500);
    }
  }
</script>

{#if ended}
  <p class="closed">Este leilão foi encerrado.</p>
{:else if isLeader}
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
