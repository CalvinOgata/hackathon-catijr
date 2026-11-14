<script lang="ts">
  import type { Auction } from '@auction/shared';
  import { page } from '$app/state';
  import { api } from '#lib/api.ts';
  import { auth } from '#lib/auth.svelte.ts';
  import AuctionCard from '#lib/components/AuctionCard.svelte';
  import AuctionHero from '#lib/components/AuctionHero.svelte';
  import { AuctionRoom } from '#lib/room.svelte.ts';
  import { socket } from '#lib/socket.svelte.ts';

  let auctions = $state<Auction[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let category = $state('All');
  let heroIndex = $state(0);
  let heroRoom = $state<AuctionRoom | null>(null);

  const query = $derived(page.url.searchParams.get('q')?.trim() ?? '');
  const userId = $derived(auth.user?.id);

  const featured = $derived.by(() => {
    const list = auctions.filter((a) => a.featured);
    return list.length ? list : auctions.slice(0, 1);
  });
  const hero = $derived(featured.length ? featured[heroIndex % featured.length] : undefined);
  const heroId = $derived(hero?.id);

  const categories = $derived(['All', ...new Set(auctions.map((a) => a.category))]);
  const visible = $derived(category === 'All' ? auctions : auctions.filter((a) => a.category === category));

  // (Re)load whenever the search changes
  $effect(() => {
    const q = query;
    let cancelled = false;
    loading = true;
    error = null;

    api
      .get<Auction[]>(q ? `/auctions?q=${encodeURIComponent(q)}` : '/auctions')
      .then((result) => {
        if (cancelled) return;
        auctions = result;
        category = 'All';
      })
      .catch((err) => !cancelled && (error = err.message))
      .finally(() => !cancelled && (loading = false));

    return () => (cancelled = true);
  });

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

  // Public listing updates, for everyone
  $effect(() => {
    const onUpdated = (auction: Auction) => {
      const index = auctions.findIndex((a) => a.id === auction.id);
      if (index !== -1) auctions[index] = auction;
    };
    const onCreated = (auction: Auction) => {
      if (!query) auctions.push(auction);
    };
    socket.on('auction:updated', onUpdated);
    socket.on('auction:created', onCreated);
    return () => {
      socket.off('auction:updated', onUpdated);
      socket.off('auction:created', onCreated);
    };
  });

  const move = (step: number) => (heroIndex = (heroIndex + step + featured.length) % featured.length);
</script>

<svelte:head>
  <title>{query ? `“${query}” · Arremate` : 'Arremate · Live auctions'}</title>
</svelte:head>

{#if error}
  <p class="alert alert-error">Could not load auctions: {error}</p>
{:else if loading && !auctions.length}
  <div class="skeleton hero-skeleton"></div>
{/if}

{#if hero && !query}
  <section class="featured" aria-label="Featured auction">
    <AuctionHero auction={hero} room={heroRoom}>
      {#snippet controls()}
        {#if featured.length > 1}
          <div class="carousel">
            <button onclick={() => move(-1)} aria-label="Previous featured auction">‹</button>
            <span class="muted">{(heroIndex % featured.length) + 1} / {featured.length}</span>
            <button onclick={() => move(1)} aria-label="Next featured auction">›</button>
          </div>
        {/if}
      {/snippet}
    </AuctionHero>
  </section>
{/if}

<section class="all">
  <div class="section-head">
    <h2>{query ? `Results for “${query}”` : 'All auctions'}</h2>
    {#if !loading || auctions.length}
      <span class="muted">{visible.length} {visible.length === 1 ? 'auction' : 'auctions'}</span>
    {/if}
  </div>

  {#if categories.length > 2}
    <div class="chips" role="tablist" aria-label="Categories">
      {#each categories as name (name)}
        <button role="tab" aria-selected={category === name} class:active={category === name} onclick={() => (category = name)}>
          {name}
        </button>
      {/each}
    </div>
  {/if}

  {#if visible.length}
    <div class="grid">
      {#each visible as auction (auction.id)}
        <AuctionCard {auction} />
      {/each}
    </div>
  {:else if !loading && !error}
    <p class="empty muted">No auctions found{query ? ` for “${query}”` : ''}.</p>
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
