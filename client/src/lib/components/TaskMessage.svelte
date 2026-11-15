<script lang="ts">
  import type { Task } from '#lib/task.svelte.ts';

  let { task }: { task: Task } = $props();
</script>

{#if task.error}
  <p class="alert alert-error" role="alert">{task.error}</p>
{:else if task.success}
  <p class="alert alert-success" role="status">{task.success}</p>
{/if}
