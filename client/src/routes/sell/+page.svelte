<script lang="ts">
  import { CATEGORIES, LISTING_LIMITS, type Auction, type Category } from '@auction/shared';
  import { goto } from '$app/navigation';
  import { api } from '#lib/api.ts';
  import { auth } from '#lib/auth.svelte.ts';

  const DURATIONS = [
    { label: '15 minutos', minutes: 15 },
    { label: '1 hora', minutes: 60 },
    { label: '6 horas', minutes: 6 * 60 },
    { label: '1 dia', minutes: 24 * 60 },
    { label: '3 dias', minutes: 3 * 24 * 60 },
    { label: '7 dias', minutes: 7 * 24 * 60 },
  ];

  let title = $state('');
  let category = $state<Category>(CATEGORIES[0]);
  let description = $state('');
  let imageUrl = $state('');
  /** Prices in reais, as typed. */
  let startingPrice = $state<number | null>(null);
  let minIncrement = $state<number | null>(10);
  let durationMinutes = $state(24 * 60);
  let error = $state<string | null>(null);
  let submitting = $state(false);

  // Listing items requires login (RF03)
  $effect(() => {
    if (auth.ready && !auth.user) goto('/login?redirect=/sell', { replace: true });
  });

  const toCents = (reais: number | null) => Math.round((reais ?? 0) * 100);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    submitting = true;
    error = null;
    try {
      const auction = await api.post<Auction>('/auctions', {
        title,
        category,
        description,
        imageUrl: imageUrl.trim() || undefined,
        startingPrice: toCents(startingPrice),
        minIncrement: toCents(minIncrement),
        durationMinutes,
      });
      await goto(`/auctions/${auction.id}`);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Anunciar item · Arremate</title>
</svelte:head>

{#if auth.user}
  <div class="auth-page">
    <form class="auth-card sell" onsubmit={submit}>
      <div>
        <h1>Anunciar um item</h1>
        <p class="muted">O leilão começa assim que você publicar. Você não pode dar lances nos próprios itens.</p>
      </div>

      <label>
        <span>Nome</span>
        <input class="input" required minlength="3" maxlength="100" bind:value={title} placeholder="ex.: Fender Stratocaster 1979" />
      </label>

      <label>
        <span>Categoria</span>
        <select class="input" bind:value={category}>
          {#each CATEGORIES as name (name)}
            <option value={name}>{name}</option>
          {/each}
        </select>
      </label>

      <label>
        <span>Descrição</span>
        <textarea class="input" rows="4" maxlength="2000" bind:value={description} placeholder="Estado de conservação, histórico, o que acompanha…"></textarea>
      </label>

      <label>
        <span>URL da imagem <small class="muted">(opcional)</small></span>
        <input class="input" type="url" pattern="https?://.+" maxlength="500" bind:value={imageUrl} placeholder="https://…" />
      </label>

      <div class="row">
        <label>
          <span>Preço inicial (R$)</span>
          <input class="input" type="number" required step="0.01" min={LISTING_LIMITS.minPrice / 100} max={LISTING_LIMITS.maxPrice / 100} bind:value={startingPrice} />
        </label>
        <label>
          <span>Incremento mínimo (R$)</span>
          <input class="input" type="number" required step="0.01" min={LISTING_LIMITS.minPrice / 100} max={LISTING_LIMITS.maxPrice / 100} bind:value={minIncrement} />
        </label>
      </div>

      <label>
        <span>Duração</span>
        <select class="input" bind:value={durationMinutes}>
          {#each DURATIONS as option (option.minutes)}
            <option value={option.minutes}>{option.label}</option>
          {/each}
        </select>
      </label>

      {#if error}
        <p class="alert alert-error" role="alert">{error}</p>
      {/if}

      <button class="btn btn-primary" disabled={submitting}>{submitting ? 'Publicando…' : 'Publicar leilão'}</button>
    </form>
  </div>
{/if}

<style>
  .sell {
    max-width: 560px;
  }

  textarea.input {
    height: auto;
    padding: 10px 14px;
    resize: vertical;
  }

  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  @media (max-width: 480px) {
    .row {
      grid-template-columns: 1fr;
    }
  }
</style>
