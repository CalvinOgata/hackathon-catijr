<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth } from '#lib/auth.svelte.ts';
  import { connection } from '#lib/socket.svelte.ts';

  let query = $state('');
  let input: HTMLInputElement;
  let debounce: ReturnType<typeof setTimeout>;

  // Follow the URL (e.g. clicking the logo clears the search), but never
  // overwrite what the user is typing right now.
  $effect(() => {
    const q = page.url.searchParams.get('q') ?? '';
    if (document.activeElement !== input) query = q;
  });

  function search() {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const q = query.trim();
      goto(q ? `/?q=${encodeURIComponent(q)}` : '/', { replace: page.url.pathname === '/', reset: false });
    }, 250);
  }

  const loginHref = $derived(
    page.url.pathname === '/login' || page.url.pathname === '/signup'
      ? '/login'
      : `/login?redirect=${encodeURIComponent(page.url.pathname + page.url.search)}`,
  );
</script>

<header>
  <div class="container bar">
    <a href="/" class="logo">
      <img src="/favicon.svg" alt="" width="28" height="28" />
      <span>Arremate</span>
    </a>

    <label class="search">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="m21 21-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <input bind:this={input} bind:value={query} oninput={search} type="search" placeholder="Buscar leilões" aria-label="Buscar leilões" />
    </label>

    <div class="actions">
      <span class="live" class:on={connection.connected} title={connection.connected ? 'Recebendo atualizações ao vivo' : 'Conectando…'}>
        <span class="dot"></span>Ao vivo
      </span>

      {#if !auth.ready}
        <!-- Avoid flashing the login buttons while the session is restored -->
      {:else if auth.user}
        <a href="/sell" class="btn btn-primary">Anunciar<span class="wide">&nbsp;item</span></a>
        <a href="/account" class="btn btn-ghost account" title="Minha conta" aria-label="Minha conta ({auth.user.name})">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="M4 21a8 8 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <span class="user">{auth.user.name}</span>
        </a>
        <button class="btn btn-ghost" onclick={() => auth.logout()}>Sair</button>
      {:else}
        <a href={loginHref} class="btn btn-ghost">Entrar</a>
        <a href="/signup" class="btn btn-primary">Criar conta</a>
      {/if}
    </div>
  </div>
</header>

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 10;
    height: var(--header-height);
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 24px;
    height: 100%;
  }

  .logo {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    font-size: 18px;
  }

  .search {
    flex: 1;
    min-width: 0;
    max-width: 560px;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    background: var(--surface-2);
    border: 1px solid transparent;
    border-radius: 10px;
    color: var(--muted);
    transition: border-color 0.15s;
  }

  .search:focus-within {
    border-color: var(--accent);
  }

  .search input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
  }

  .actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .live {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
  }

  .live.on {
    color: var(--green);
  }

  .live.on .dot {
    background: var(--green);
    box-shadow: 0 0 0 3px var(--green-soft);
  }

  .account {
    max-width: 200px;
  }

  .user {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (max-width: 720px) {
    .bar {
      gap: 12px;
    }

    .logo span,
    .live,
    .user,
    .wide {
      display: none;
    }

    .actions {
      gap: 4px;
    }

    .actions .btn {
      padding: 0 10px;
    }
  }
</style>
