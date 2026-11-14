<script lang="ts">
  import { minNextBid, type Auction } from '@auction/shared';
  import { clock } from '#lib/clock.svelte.ts';
  import { formatMoney } from '#lib/format.ts';
  import { socket } from '#lib/socket.svelte.ts';

  let { auction }: { auction: Auction } = $props();

  const minimum = $derived(minNextBid(auction));
  const ended = $derived(Date.parse(auction.endsAt) <= clock.now);

  /** In reais, as typed by the user. */
  let amount = $state<number | null>(null);
  let submitting = $state(false);
  let feedback = $state<{ kind: 'error' | 'success'; text: string } | null>(null);

  // Suggest the minimum, and bump the amount up when someone else outbids
  $effect(() => {
    if (amount === null || amount * 100 < minimum) amount = minimum / 100;
  });

  const quickIncrements = $derived([1, 5, 10].map((times) => times * auction.minIncrement));

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (amount === null) return;

    submitting = true;
    feedback = null;
    try {
      const result = await socket.timeout(5000).emitWithAck('bid:place', {
        auctionId: auction.id,
        amount: Math.round(amount * 100),
      });
      feedback = result.ok ? { kind: 'success', text: 'Lance registrado! Você está na liderança.' } : { kind: 'error', text: result.error };
    } catch {
      feedback = { kind: 'error', text: 'O servidor não respondeu. Tente novamente.' };
    } finally {
      submitting = false;
    }
  }
</script>

{#if ended}
  <p class="closed">Este leilão foi encerrado.</p>
{:else}
  <form onsubmit={submit}>
    <label for="bid-amount" class="label">
      Seu lance <span class="muted">· mín. {formatMoney(minimum)}</span>
    </label>
    <div class="amount">
      <span class="currency">R$</span>
      <input id="bid-amount" class="input" type="number" inputmode="decimal" step="0.01" min={minimum / 100} required bind:value={amount} />
    </div>

    <div class="quick">
      {#each quickIncrements as increment (increment)}
        <button type="button" onclick={() => (amount = (amount ?? 0) + increment / 100)}>+{formatMoney(increment)}</button>
      {/each}
    </div>

    <button class="btn btn-primary full" disabled={submitting}>
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
</style>
