<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { auth } from '#lib/auth.svelte.ts';
  import Header from '#lib/components/Header.svelte';
  import { socket } from '#lib/socket.svelte.ts';

  let { children } = $props();

  onMount(() => {
    // Restore the session first so the socket connects with the user's token
    auth.init().finally(() => socket.connect());
    return () => socket.disconnect();
  });
</script>

<Header />

{#if auth.notice}
  <div class="container">
    <div class="alert alert-error notice" role="alert">
      <span>{auth.notice}</span>
      <a href="/login?redirect={encodeURIComponent(page.url.pathname + page.url.search)}">Log in</a>
      <button onclick={() => (auth.notice = null)} aria-label="Dismiss">×</button>
    </div>
  </div>
{/if}

<main class="container">
  {@render children()}
</main>

<style>
  .notice {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 16px;
  }

  .notice a {
    font-weight: 700;
    text-decoration: underline;
  }

  .notice button {
    margin-left: auto;
    background: none;
    border: none;
    color: inherit;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }

  main {
    padding-top: 24px;
    padding-bottom: 64px;
  }
</style>
