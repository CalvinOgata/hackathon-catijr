<script lang="ts">
  import { clock } from '#lib/clock.svelte.ts';
  import { formatTimeLeft } from '#lib/format.ts';

  interface Props {
    /** Counts down to this moment (an auction's start or end). */
    until: string;
    /** Turn red in the last hour: right for "ends in", not for "starts in". */
    warn?: boolean;
  }

  let { until, warn = true }: Props = $props();

  const msLeft = $derived(Date.parse(until) - clock.now);
</script>

<span class:urgent={warn && msLeft > 0 && msLeft < 60 * 60 * 1000} class:ended={msLeft <= 0}>
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
