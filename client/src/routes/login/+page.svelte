<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth } from '#lib/auth.svelte.ts';
  import { safeRedirect } from '#lib/format.ts';

  let email = $state('');
  let password = $state('');
  let error = $state<string | null>(null);
  let submitting = $state(false);

  const redirect = $derived(safeRedirect(page.url.searchParams.get('redirect')));

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    submitting = true;
    error = null;
    try {
      await auth.login(email, password);
      await goto(redirect);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Log in · Arremate</title>
</svelte:head>

<div class="auth-page">
  <form class="auth-card" onsubmit={submit}>
    <div>
      <h1>Welcome back</h1>
      <p class="muted">Log in to place bids on live auctions.</p>
    </div>

    <label>
      <span>Email</span>
      <input class="input" type="email" autocomplete="email" required bind:value={email} />
    </label>

    <label>
      <span>Password</span>
      <input class="input" type="password" autocomplete="current-password" required bind:value={password} />
    </label>

    {#if error}
      <p class="alert alert-error" role="alert">{error}</p>
    {/if}

    <button class="btn btn-primary" disabled={submitting}>{submitting ? 'Logging in…' : 'Log in'}</button>

    <p class="muted switch">
      New here? <a href="/signup?redirect={encodeURIComponent(redirect)}">Create an account</a>
    </p>
  </form>
</div>
