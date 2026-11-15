<script lang="ts">
  import { canCancel, type Auction } from '@auction/shared';
  import { api } from '#lib/api.ts';
  import { clock } from '#lib/clock.svelte.ts';
  import { Task } from '#lib/task.svelte.ts';
  import TaskMessage from './TaskMessage.svelte';

  // RF08: shown to the seller only. The server makes the final decision; this just
  // avoids offering a button that would be refused.
  let { auction }: { auction: Auction } = $props();

  let confirming = $state(false);
  const cancel = new Task();

  const allowed = $derived(canCancel(auction, clock.now));

  async function confirm() {
    // Everyone, this page included, gets the new status through the live connection
    if (await cancel.run(() => api.post(`/auctions/${auction.id}/cancel`))) confirming = false;
  }
</script>

{#if allowed}
  <div class="cancel">
    {#if confirming}
      <p><strong>Cancelar este leilão?</strong></p>
      <p class="muted small">Ele continua registrado como Cancelado e não recebe mais lances. Não dá para desfazer.</p>
      <div class="actions">
        <button class="btn danger" disabled={cancel.pending} onclick={confirm}>{cancel.pending ? 'Cancelando…' : 'Sim, cancelar'}</button>
        <button class="btn btn-ghost" disabled={cancel.pending} onclick={() => (confirming = false)}>Voltar</button>
      </div>
    {:else}
      <button class="btn btn-ghost danger-text" onclick={() => (confirming = true)}>Cancelar leilão</button>
    {/if}
    <TaskMessage task={cancel} />
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
