<script lang="ts">
  import { auctionStatus, CATEGORIES, isOpenStatus, LISTING_PAGE_SIZE, listingOrder, type Auction, type AuctionPage } from '@auction/shared';
  import { page } from '$app/state';
  import { api } from '#lib/api.ts';
  import { auth } from '#lib/auth.svelte.ts';
  import { serverNow } from '#lib/clock.svelte.ts';
  import AuctionCard from '#lib/components/AuctionCard.svelte';
  import AuctionHero from '#lib/components/AuctionHero.svelte';
  import { AuctionRoom } from '#lib/room.svelte.ts';
  import { listen } from '#lib/socket.svelte.ts';

  // The public listing (RF20): scheduled and live auctions only, in the server's order, a page at
  // a time. Auctions that close or are cancelled leave the list as soon as the server says so.

  const ALL = 'Todas';

  let auctions = $state<Auction[]>([]);
  let total = $state(0);
  let featured = $state<Auction[]>([]);
  let loading = $state(true);
  let loadingMore = $state(false);
  let error = $state<string | null>(null);
  let category = $state(ALL);
  let heroIndex = $state(0);
  let heroRoom = $state<AuctionRoom | null>(null);

  const query = $derived(page.url.searchParams.get('q')?.trim() ?? '');
  const userId = $derived(auth.user?.id);
  const hero = $derived(featured.length ? featured[heroIndex % featured.length] : undefined);
  const heroId = $derived(hero?.id);
  const hasMore = $derived(auctions.length < total);

  function pageUrl(offset: number) {
    const params = new URLSearchParams({ offset: String(offset), limit: String(LISTING_PAGE_SIZE) });
    if (query) params.set('q', query);
    if (category !== ALL) params.set('category', category);
    return `/auctions?${params}`;
  }

  // (Re)load the first page whenever the search or the category changes
  $effect(() => {
    const url = pageUrl(0);
    let cancelled = false;
    loading = true;
    error = null;

    api
      .get<AuctionPage>(url)
      .then((result) => {
        if (cancelled) return;
        auctions = result.auctions;
        total = result.total;
      })
      .catch((err) => !cancelled && (error = err.message))
      .finally(() => !cancelled && (loading = false));

    return () => (cancelled = true);
  });

  // A new search starts from all categories
  $effect(() => {
    void query;
    category = ALL;
  });

  // The carousel, loaded once
  $effect(() => {
    api
      .get<Auction[]>('/auctions/featured')
      .then((result) => (featured = result))
      .catch(() => {}); // the listing below shows the error
  });

  async function loadMore() {
    if (loadingMore) return;
    loadingMore = true;
    try {
      const result = await api.get<AuctionPage>(pageUrl(auctions.length));
      // Skip any that moved into the loaded part meanwhile
      const loaded = new Set(auctions.map((a) => a.id));
      auctions.push(...result.auctions.filter((a) => !loaded.has(a.id)));
      total = result.total;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loadingMore = false;
    }
  }

  // Logged-in users are inside the featured auction's room; guests only see the listing (RF04)
  $effect(() => {
    if (heroId === undefined || userId === undefined || query) {
      heroRoom = null;
      return;
    }
    const room = new AuctionRoom(heroId);
    heroRoom = room;
    return () => room.leave();
  });

  const isOpen = (auction: Auction) => isOpenStatus(auctionStatus(auction, serverNow()));
  const matchesFilters = (auction: Auction) => !query && (category === ALL || auction.category === category);

  // Public listing updates, for everyone
  $effect(() =>
    listen('auction:updated', (auction) => {
      const index = auctions.findIndex((a) => a.id === auction.id);
      if (index !== -1) {
        if (isOpen(auction)) auctions[index] = auction;
        else {
          // Closed or cancelled: no longer listed (RF20)
          auctions.splice(index, 1);
          total--;
        }
      }
      const featuredIndex = featured.findIndex((a) => a.id === auction.id);
      if (featuredIndex !== -1) featured[featuredIndex] = auction; // the carousel shows how it ended
    }),
  );

  $effect(() =>
    listen('auction:created', (auction) => {
      if (!matchesFilters(auction) || !isOpen(auction)) return;
      total++;
      // Into its place in the order, if that's within what's loaded
      const now = serverNow();
      const index = auctions.findIndex((a) => listingOrder(auction, a, now) < 0);
      if (index !== -1) auctions.splice(index, 0, auction);
      else if (!hasMore) auctions.push(auction);
    }),
  );

  const move = (step: number) => (heroIndex = (heroIndex + step + featured.length) % featured.length);
</script>

<svelte:head>
  <title>{query ? `“${query}” · Arremate` : 'Arremate · Leilões ao vivo'}</title>
</svelte:head>

{#if error}
  <p class="alert alert-error">Não foi possível carregar os leilões: {error}</p>
{:else if loading && !auctions.length && !featured.length}
  <div class="skeleton hero-skeleton"></div>
{/if}

{#if hero && !query}
  <section class="featured" aria-label="Leilão em destaque">
    <AuctionHero auction={hero} room={heroRoom}>
      {#snippet controls()}
        {#if featured.length > 1}
          <div class="carousel">
            <button onclick={() => move(-1)} aria-label="Leilão em destaque anterior">‹</button>
            <span class="muted">{(heroIndex % featured.length) + 1} / {featured.length}</span>
            <button onclick={() => move(1)} aria-label="Próximo leilão em destaque">›</button>
          </div>
        {/if}
      {/snippet}
    </AuctionHero>
  </section>
{/if}

<section class="all">
  <div class="section-head">
    <h2>{query ? `Resultados para “${query}”` : 'Leilões abertos'}</h2>
    {#if !loading || auctions.length}
      <span class="muted">{total} {total === 1 ? 'leilão' : 'leilões'}</span>
    {/if}
  </div>
  <p class="muted hint">Em andamento (terminando antes primeiro) e agendados (começando antes primeiro).</p>

  <div class="chips" role="tablist" aria-label="Categorias">
    {#each [ALL, ...CATEGORIES] as name (name)}
      <button role="tab" aria-selected={category === name} class:active={category === name} onclick={() => (category = name)}>
        {name}
      </button>
    {/each}
  </div>

  {#if auctions.length}
    <div class="grid">
      {#each auctions as auction (auction.id)}
        <AuctionCard {auction} />
      {/each}
    </div>
    {#if hasMore}
      <div class="more">
        <button class="btn btn-ghost" onclick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Carregando…' : `Carregar mais (${total - auctions.length} ${total - auctions.length === 1 ? 'restante' : 'restantes'})`}
        </button>
      </div>
    {/if}
  {:else if !loading && !error}
    <p class="empty muted">
      Nenhum leilão aberto{query ? ` para “${query}”` : ''}{category !== ALL ? ` em ${category}` : ''}.
    </p>
  {/if}
</section>

<style>
  .featured {
    margin-bottom: 40px;
  }

  .carousel {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    font-size: 13px;
  }

  .carousel button {
    width: 34px;
    height: 34px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 50%;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }

  .carousel button:hover {
    border-color: var(--accent);
  }

  .section-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 14px;
  }

  .section-head h2 {
    font-size: 22px;
  }

  .hint {
    margin: -8px 0 14px;
    font-size: 13px;
  }

  .more {
    display: flex;
    justify-content: center;
    margin-top: 24px;
  }

  .chips {
    display: flex;
    gap: 8px;
    margin-bottom: 20px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .chips button {
    flex-shrink: 0;
    height: 34px;
    padding: 0 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
  }

  .chips button:hover {
    border-color: var(--accent);
  }

  .chips button.active {
    background: var(--text);
    border-color: var(--text);
    color: var(--bg);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
  }

  .empty {
    padding: 48px 0;
    text-align: center;
  }

  .skeleton {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 18px;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .hero-skeleton {
    height: 420px;
    margin-bottom: 40px;
  }

  @keyframes pulse {
    50% {
      opacity: 0.5;
    }
  }
</style>
