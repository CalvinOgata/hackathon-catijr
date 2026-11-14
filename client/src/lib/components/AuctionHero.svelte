<script lang="ts">
  import type { Auction } from '@auction/shared';
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { auth } from '#lib/auth.svelte.ts';
  import { clock } from '#lib/clock.svelte.ts';
  import { formatMoney, formatTimeAgo } from '#lib/format.ts';
  import type { AuctionRoom } from '#lib/room.svelte.ts';
  import { flash } from '#lib/transitions.ts';
  import AuctionImage from './AuctionImage.svelte';
  import BidForm from './BidForm.svelte';
  import Countdown from './Countdown.svelte';

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

  const auction = $derived(room?.auction?.id === listing.id ? room.auction : listing);
  const isSeller = $derived(auth.user?.id === auction.sellerId);
  const here = $derived(encodeURIComponent(page.url.pathname + page.url.search));
</script>

<article class="hero">
  <div class="main">
    <header>
      <div>
        <span class="category">{auction.category}</span>
        <svelte:element this={headingLevel} class="title">{auction.title}</svelte:element>
        <p class="seller muted">Listed by <strong>{isSeller ? 'you' : auction.sellerName}</strong></p>
      </div>
      {@render controls?.()}
    </header>

    <AuctionImage {auction} alt={auction.title} class="cover" />
    {#if auction.description}
      <p class="description muted">{auction.description}</p>
    {/if}
  </div>

  <aside class="panel">
    <div class="stats">
      <div>
        <span class="label">{auction.bidCount ? 'Current bid' : 'Starting price'}</span>
        {#key auction.currentPrice}
          <strong class="price" in:flash>{formatMoney(auction.currentPrice)}</strong>
        {/key}
        <span class="muted small">{auction.bidCount} {auction.bidCount === 1 ? 'bid' : 'bids'}</span>
      </div>
      <div class="ends">
        <span class="label">Ends in</span>
        <strong><Countdown endsAt={auction.endsAt} /></strong>
      </div>
    </div>

    {#if !auth.user}
      <div class="gate">
        <p><strong>The auction room is for members.</strong></p>
        <p class="muted small">Log in to follow bids live and place your own.</p>
        <a class="btn btn-primary full" href="/login?redirect={here}">Log in to enter the room</a>
        <a class="btn btn-ghost full" href="/signup?redirect={here}">Create an account</a>
      </div>
    {:else if room?.error}
      <p class="alert alert-error">{room.error}</p>
    {:else if !room?.joined}
      <p class="muted small">Entering the auction room…</p>
    {:else}
      {#if isSeller}
        <p class="note">This is your auction. Sellers can't bid on their own items.</p>
      {:else}
        {#key auction.id}
          <BidForm {auction} />
        {/key}
      {/if}

      <section class="history">
        <h3>Recent bids</h3>
        {#if room.bids.length}
          <ul>
            {#each room.bids as bid (bid.id)}
              <li in:flash>
                <span class="bidder">{bid.bidderName}</span>
                <span class="amount">{formatMoney(bid.amount)}</span>
                <span class="muted small">{formatTimeAgo(bid.createdAt, clock.now)}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted small">No bids yet.{isSeller ? '' : ' Be the first!'}</p>
        {/if}
      </section>
    {/if}
  </aside>
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

  .main :global(.cover) {
    width: 100%;
    aspect-ratio: 2 / 1;
    max-height: 360px;
    border-radius: 12px;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .stats {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 16px;
    background: var(--surface-2);
    border-radius: 12px;
  }

  .stats > div {
    display: flex;
    flex-direction: column;
  }

  .ends {
    text-align: right;
  }

  .ends strong {
    font-size: 20px;
  }

  .label {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .price {
    margin: 0 -4px;
    padding: 0 4px;
    border-radius: 6px;
    font-size: 30px;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }

  .small {
    font-size: 13px;
  }

  .gate {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border: 1px dashed var(--border);
    border-radius: 12px;
  }

  .gate .small {
    margin-bottom: 4px;
  }

  .full {
    width: 100%;
    height: 44px;
  }

  .note {
    padding: 12px 14px;
    background: var(--accent-soft);
    color: var(--accent);
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
  }

  .history h3 {
    margin-bottom: 8px;
    font-size: 14px;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 220px;
    overflow-y: auto;
  }

  li {
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 8px;
    padding: 8px;
    border-radius: 8px;
    border-bottom: 1px solid var(--border);
  }

  li:last-child {
    border-bottom: none;
  }

  .bidder {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .amount {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 900px) {
    .hero {
      grid-template-columns: 1fr;
      padding: 16px;
    }

    .title {
      font-size: 22px;
    }
  }
</style>
