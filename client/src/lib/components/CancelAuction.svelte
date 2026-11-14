<script lang="ts">
  import { canCancel, type Auction } from '@auction/shared';
  import { api } from '#lib/api.ts';
  import { clock } from '#lib/clock.svelte.ts';

  // RF08: shown to the seller only. The server makes the final decision; this just
  // avoids offering a button that would be refused.
  let { auction }: { auction: Auction } = $props();

  let confirming = $state(false);
  let cancelling = $state(false);
  let error = $state<string | null>(null);

  const allowed = $derived(canCancel(auction, clock.now));

  async function confirm() {
    cancelling = true;
    error = null;
    try {
      // Everyone, this page included, gets the new status through the live connection
      await api.post(`/auctions/${auction.id}/cancel`);
      confirming = false;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      cancelling = false;
    }
  }
</script>

{#if allowed}
  <div class="cancel">
    {#if confirming}
      <p><strong>Cancelar este leilão?</strong></p>
      <p class="muted small">Ele continua registrado como Cancelado e não recebe mais lances. Não dá para desfazer.</p>
      <div class="actions">
        <button class="btn danger" disabled={cancelling} onclick={confirm}>{cancelling ? 'Cancelando…' : 'Sim, cancelar'}</button>
        <button class="btn btn-ghost" disabled={cancelling} onclick={() => (confirming = false)}>Voltar</button>
      </div>
    {:else}
      <button class="btn btn-ghost danger-text" onclick={() => (confirming = true)}>Cancelar leilão</button>
    {/if}
    {#if error}
      <p class="alert alert-error" role="alert">{error}</p>
    {/if}
  </div>
{:else if auction.bidCount > 0 && !auction.cancelledAt && Date.parse(auction.endsAt) > clock.now}
  <p class="muted small">Leilões com lances não podem ser cancelados.</p>
{/if}

<style>
  .cancel {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .small {
    font-size: 13px;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .danger {
    background: var(--red);
    color: #fff;
  }

  .danger-text {
    align-self: flex-start;
    color: var(--red);
  }
</style>
