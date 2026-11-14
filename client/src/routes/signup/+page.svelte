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
  <title>Criar conta · Arremate</title>
</svelte:head>

<div class="auth-page">
  <form class="auth-card" onsubmit={submit}>
    <div>
      <h1>Crie sua conta</h1>
      <p class="muted">Cadastre-se para dar lances em leilões em tempo real.</p>
    </div>

    <label>
      <span>Nome de exibição</span>
      <input class="input" autocomplete="name" required minlength="2" maxlength="60" bind:value={name} />
    </label>

    <label>
      <span>E-mail</span>
      <input class="input" type="email" autocomplete="email" required bind:value={email} />
    </label>

    <label>
      <span>Senha</span>
      <input class="input" type="password" autocomplete="new-password" required minlength="8" bind:value={password} />
      <small class="muted">No mínimo 8 caracteres</small>
    </label>

    {#if error}
      <p class="alert alert-error" role="alert">{error}</p>
    {/if}

    <button class="btn btn-primary" disabled={submitting}>{submitting ? 'Criando conta…' : 'Criar conta'}</button>

    <p class="muted switch">
      Já tem uma conta? <a href="/login?redirect={encodeURIComponent(redirect)}">Entrar</a>
    </p>
  </form>
</div>
