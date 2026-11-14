<script lang="ts">
  import { clock } from '#lib/clock.svelte.ts';
  import { formatTimeLeft } from '#lib/format.ts';

  let { endsAt }: { endsAt: string } = $props();

  const msLeft = $derived(Date.parse(endsAt) - clock.now);
</script>

<span class:urgent={msLeft > 0 && msLeft < 60 * 60 * 1000} class:ended={msLeft <= 0}>
  {formatTimeLeft(msLeft)}
</span>

<style>
  span {
    font-variant-numeric: tabular-nums;
  }

  .urgent {
    color: var(--red);
  }

  .ended {
    color: var(--muted);
  }
</style>
