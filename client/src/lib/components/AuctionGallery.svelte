<script lang="ts">
  import type { Auction } from '@auction/shared';
  import AuctionImage from './AuctionImage.svelte';

  let { auction }: { auction: Auction } = $props();

  // Which photo is shown large (reset when showing another auction)
  let selected = $state(0);
  $effect(() => {
    void auction.id;
    selected = 0;
  });
</script>

<div class="gallery">
  <AuctionImage {auction} src={auction.photos[selected]} alt="{auction.title}, foto {selected + 1} de {auction.photos.length}" class="cover" />
  {#if auction.photos.length > 1}
    <div class="thumbs" role="group" aria-label="Fotos do item">
      {#each auction.photos as photo, index (photo)}
        <button
          type="button"
          class:active={index === selected}
          aria-label="Ver foto {index + 1}"
          aria-pressed={index === selected}
          onclick={() => (selected = index)}
        >
          <AuctionImage {auction} src={photo} class="thumb" loading="lazy" />
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .gallery {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .gallery :global(.cover) {
    width: 100%;
    aspect-ratio: 2 / 1;
    max-height: 360px;
    border-radius: 12px;
  }

  .thumbs {
    display: flex;
    gap: 8px;
    overflow-x: auto;
  }

  .thumbs button {
    flex-shrink: 0;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 10px;
    background: none;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.15s, border-color 0.15s;
  }

  .thumbs button:hover,
  .thumbs button.active {
    opacity: 1;
  }

  .thumbs button.active {
    border-color: var(--accent);
  }

  .thumbs :global(.thumb) {
    width: 72px;
    height: 54px;
    border-radius: 8px;
  }
</style>
