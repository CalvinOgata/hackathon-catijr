<script lang="ts">
  import type { Auction } from '@auction/shared';
  import type { Snippet } from 'svelte';
  import { auth } from '#lib/auth.svelte.ts';
  import type { AuctionRoom } from '#lib/room.svelte.ts';
  import AuctionGallery from './AuctionGallery.svelte';
  import AuctionPanel from './AuctionPanel.svelte';

  interface Props {
    /** Public listing data. */
    auction: Auction;
    /** The live room, when the user is logged in (RF04). */
    room: AuctionRoom | null;
    /** Extra controls rendered next to the title (e.g. carousel arrows). */
    controls?: Snippet;
    headingLevel?: 'h1' | 'h2';
  }

  let { auction: listing, room, controls, headingLevel = 'h1' }: Props = $props();

  // The room's copy is fresher (updated with every bid) once it's this auction's
  const auction = $derived(room?.auction?.id === listing.id ? room.auction : listing);
  const isSeller = $derived(auth.user?.id === auction.sellerId);
</script>

<article class="hero">
  <div class="main">
    <header>
      <div>
        <span class="category">{auction.category}</span>
        <svelte:element this={headingLevel} class="title">{auction.title}</svelte:element>
        <p class="seller muted">Anunciado por <strong>{isSeller ? 'você' : auction.sellerName}</strong></p>
      </div>
      {@render controls?.()}
    </header>

    <AuctionGallery {auction} />

    {#if auction.description}
      <p class="description muted">{auction.description}</p>
    {/if}
  </div>

  <AuctionPanel {auction} {room} />
</article>

<style>
  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 24px;
    padding: 24px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 18px;
    box-shadow: var(--shadow);
  }

  .main {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .category {
    display: inline-block;
    margin-bottom: 4px;
    padding: 2px 10px;
    background: var(--accent-soft);
    color: var(--accent);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
  }

  .title {
    margin: 0;
    font-size: 26px;
    line-height: 1.25;
  }

  .seller {
    margin-top: 4px;
    font-size: 14px;
  }

  .seller strong {
    color: var(--text);
    font-weight: 600;
  }

  @media (max-width: 900px) {
    .hero {
      grid-template-columns: minmax(0, 1fr);
      padding: 16px;
    }

    .title {
      font-size: 22px;
    }
  }
</style>
