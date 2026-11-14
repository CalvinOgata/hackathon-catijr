<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth } from '#lib/auth.svelte.ts';
  import { safeRedirect } from '#lib/format.ts';

  let name = $state('');
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
      await auth.signup(name, email, password);
      await goto(redirect);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Sign up · Arremate</title>
</svelte:head>

<div class="auth-page">
  <form class="auth-card" onsubmit={submit}>
    <div>
      <h1>Create your account</h1>
      <p class="muted">Join to bid on live auctions in real time.</p>
    </div>

    <label>
      <span>Name</span>
      <input class="input" autocomplete="name" required minlength="2" maxlength="60" bind:value={name} />
    </label>

    <label>
      <span>Email</span>
      <input class="input" type="email" autocomplete="email" required bind:value={email} />
    </label>

    <label>
      <span>Password</span>
      <input class="input" type="password" autocomplete="new-password" required minlength="8" bind:value={password} />
      <small class="muted">At least 8 characters</small>
    </label>

    {#if error}
      <p class="alert alert-error" role="alert">{error}</p>
    {/if}

    <button class="btn btn-primary" disabled={submitting}>{submitting ? 'Creating account…' : 'Sign up'}</button>

    <p class="muted switch">
      Already have an account? <a href="/login?redirect={encodeURIComponent(redirect)}">Log in</a>
    </p>
  </form>
</div>
