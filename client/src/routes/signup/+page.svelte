<script lang="ts">
  import { DISPLAY_NAME_LENGTH, PASSWORD_LENGTH, passwordProblems } from '@auction/shared';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth } from '#lib/auth.svelte.ts';
  import PasswordChecklist from '#lib/components/PasswordChecklist.svelte';
  import { safeRedirect } from '#lib/format.ts';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let confirmation = $state('');
  let error = $state<string | null>(null);
  let submitting = $state(false);
  /** Only point out problems after the user tried to submit (or finished typing the confirmation). */
  let attempted = $state(false);

  const redirect = $derived(safeRedirect(page.url.searchParams.get('redirect')));
  const passwordValid = $derived(passwordProblems(password).length === 0);
  const passwordsMatch = $derived(password === confirmation);
  const showMismatch = $derived(!passwordsMatch && (attempted || confirmation.length >= password.length));

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    attempted = true;
    error = null;

    if (!passwordValid) {
      error = 'A senha ainda não atende a todos os requisitos.';
      return;
    }
    if (!passwordsMatch) {
      error = 'As senhas não coincidem.';
      return;
    }

    submitting = true;
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
      <input
        class="input"
        autocomplete="name"
        required
        minlength={DISPLAY_NAME_LENGTH.min}
        maxlength={DISPLAY_NAME_LENGTH.max}
        bind:value={name}
      />
    </label>

    <label>
      <span>E-mail</span>
      <input class="input" type="email" autocomplete="email" required bind:value={email} />
    </label>

    <label>
      <span>Senha</span>
      <input
        class="input"
        type="password"
        autocomplete="new-password"
        required
        maxlength={PASSWORD_LENGTH.max}
        aria-invalid={attempted && !passwordValid}
        aria-describedby="password-rules"
        bind:value={password}
      />
    </label>
    <div id="password-rules">
      <PasswordChecklist {password} />
    </div>

    <label>
      <span>Confirme a senha</span>
      <input
        class="input"
        type="password"
        autocomplete="new-password"
        required
        maxlength={PASSWORD_LENGTH.max}
        aria-invalid={showMismatch}
        aria-describedby="confirmation-hint"
        bind:value={confirmation}
      />
      {#if showMismatch}
        <small id="confirmation-hint" class="field-error">As senhas não coincidem</small>
      {:else if confirmation && passwordsMatch}
        <small id="confirmation-hint" class="field-ok">As senhas coincidem</small>
      {/if}
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
