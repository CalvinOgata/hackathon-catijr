<script lang="ts">
  import type { Auction } from '@auction/shared';
  import { formatMoney } from '#lib/format.ts';
  import { flash } from '#lib/transitions.ts';
  import AuctionImage from './AuctionImage.svelte';
  import Countdown from './Countdown.svelte';

  let { auction }: { auction: Auction } = $props();
</script>

<a href="/auctions/{auction.id}" class="card">
  <div class="top">
    <AuctionImage {auction} class="thumb" loading="lazy" />
    <h3>{auction.title}</h3>
  </div>

  <div class="price">
    {#key auction.currentPrice}
      <strong in:flash>{formatMoney(auction.currentPrice)}</strong>
    {/key}
    <span class="muted">{auction.bidCount ? `${auction.bidCount} ${auction.bidCount === 1 ? 'lance' : 'lances'}` : 'Nenhum lance'}</span>
  </div>

  <div class="footer">
    <span class="tag">{auction.category}</span>
    <span class="time">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <Countdown endsAt={auction.endsAt} />
    </span>
  </div>
</a>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    transition: border-color 0.15s, transform 0.15s;
  }

  .card:hover {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    transform: translateY(-2px);
  }

  .top {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }

  .top :global(.thumb) {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: 8px;
  }

  h3 {
    font-size: 15px;
    font-weight: 600;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .price {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-top: auto;
  }

  .price strong {
    padding: 0 4px;
    margin: 0 -4px;
    border-radius: 6px;
    font-size: 20px;
    font-variant-numeric: tabular-nums;
  }

  .price span {
    font-size: 13px;
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    font-size: 13px;
  }

  .tag {
    color: var(--muted);
  }

  .time {
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 600;
  }
</style>
