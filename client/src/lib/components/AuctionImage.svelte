<script lang="ts">
  import type { Auction } from '@auction/shared';

  interface Props {
    auction: Pick<Auction, 'id' | 'title'>;
    /** The photo to show; a colored placeholder is shown if missing or broken. */
    src: string | undefined;
    alt?: string;
    class?: string;
    loading?: 'lazy' | 'eager';
  }

  let { auction, src, alt = '', class: className = '', loading = 'eager' }: Props = $props();

  // Keyed by URL so the flag resets when the component is reused for another auction
  let failedSrc = $state<string | null>(null);
  const failed = $derived(failedSrc === src);

  // Stable color per auction for the placeholder
  const hue = $derived((auction.id * 47) % 360);
</script>

{#if failed || !src}
  <div class="placeholder {className}" style:--hue={hue} role={alt ? 'img' : undefined} aria-label={alt || undefined}>
    <span>{auction.title.charAt(0)}</span>
  </div>
{:else}
  <img class={className} {src} {alt} {loading} onerror={() => (failedSrc = src ?? null)} />
{/if}

<style>
  img {
    object-fit: cover;
    background: var(--surface-2);
  }

  .placeholder {
    display: grid;
    place-items: center;
    container-type: size;
    background: linear-gradient(135deg, hsl(var(--hue) 70% 55%), hsl(calc(var(--hue) + 40) 70% 40%));
    color: rgb(255 255 255 / 0.9);
    font-weight: 700;
  }

  .placeholder span {
    font-size: 40cqmin;
    line-height: 1;
  }
</style>
