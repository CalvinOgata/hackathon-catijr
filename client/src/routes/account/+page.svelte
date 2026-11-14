<script lang="ts">
  import { DISPLAY_NAME_LENGTH, normalizeDisplayName, PASSWORD_LENGTH, passwordProblems } from '@auction/shared';
  import { goto } from '$app/navigation';
  import { auth } from '#lib/auth.svelte.ts';
  import PasswordChecklist from '#lib/components/PasswordChecklist.svelte';
  import { formatDate } from '#lib/format.ts';

  type Feedback = { kind: 'error' | 'success'; text: string } | null;

  // The account page requires login
  $effect(() => {
    if (auth.ready && !auth.user) goto('/login?redirect=/account', { replace: true });
  });

  // --- Display name
  let name = $state(auth.user?.name ?? '');
  let savingName = $state(false);
  let nameFeedback = $state<Feedback>(null);

  // Fill the field once the session is restored (e.g. when opening this page directly)
  $effect(() => {
    if (auth.user && !name) name = auth.user.name;
  });

  const nameChanged = $derived(!!auth.user && normalizeDisplayName(name) !== auth.user.name);

  async function saveName(event: SubmitEvent) {
    event.preventDefault();
    savingName = true;
    nameFeedback = null;
    try {
      await auth.updateName(name);
      name = auth.user!.name;
      nameFeedback = { kind: 'success', text: 'Nome atualizado.' };
    } catch (err) {
      nameFeedback = { kind: 'error', text: (err as Error).message };
    } finally {
      savingName = false;
    }
  }

  // --- Password
  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmation = $state('');
  let changingPassword = $state(false);
  let passwordFeedback = $state<Feedback>(null);
  let attempted = $state(false);

  const newPasswordValid = $derived(passwordProblems(newPassword).length === 0);
  const passwordsMatch = $derived(newPassword === confirmation);
  const showMismatch = $derived(!passwordsMatch && (attempted || confirmation.length >= newPassword.length));

  async function changePassword(event: SubmitEvent) {
    event.preventDefault();
    attempted = true;
    passwordFeedback = null;

    if (!newPasswordValid) {
      passwordFeedback = { kind: 'error', text: 'A nova senha ainda não atende a todos os requisitos.' };
      return;
    }
    if (!passwordsMatch) {
      passwordFeedback = { kind: 'error', text: 'As senhas não coincidem.' };
      return;
    }

    changingPassword = true;
    try {
      await auth.changePassword(currentPassword, newPassword);
      currentPassword = newPassword = confirmation = '';
      attempted = false;
      passwordFeedback = { kind: 'success', text: 'Senha alterada. Suas outras sessões foram encerradas.' };
    } catch (err) {
      passwordFeedback = { kind: 'error', text: (err as Error).message };
    } finally {
      changingPassword = false;
    }
  }
</script>

<svelte:head>
  <title>Minha conta · Arremate</title>
</svelte:head>

{#if auth.user}
  <div class="account">
    <header>
      <h1>Minha conta</h1>
      <p class="muted">Membro desde {formatDate(auth.user.createdAt)}</p>
    </header>

    <form class="auth-card" onsubmit={saveName}>
      <h2>Seus dados</h2>

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
        <small class="muted">É assim que você aparece para os outros usuários.</small>
      </label>

      <label>
        <span>E-mail</span>
        <input class="input" type="email" value={auth.user.email} readonly aria-describedby="email-hint" />
        <small id="email-hint" class="muted">O e-mail identifica sua conta e não pode ser alterado.</small>
      </label>

      {#if nameFeedback}
        <p class="alert alert-{nameFeedback.kind}" role="status">{nameFeedback.text}</p>
      {/if}

      <button class="btn btn-primary" disabled={savingName || !nameChanged}>
        {savingName ? 'Salvando…' : 'Salvar nome'}
      </button>
    </form>

    <form class="auth-card" onsubmit={changePassword}>
      <div>
        <h2>Alterar senha</h2>
        <p class="muted">Ao alterar a senha, você continua conectado aqui e sai dos outros dispositivos.</p>
      </div>

      <label>
        <span>Senha atual</span>
        <input class="input" type="password" autocomplete="current-password" required maxlength={PASSWORD_LENGTH.max} bind:value={currentPassword} />
      </label>

      <label>
        <span>Nova senha</span>
        <input
          class="input"
          type="password"
          autocomplete="new-password"
          required
          maxlength={PASSWORD_LENGTH.max}
          aria-invalid={attempted && !newPasswordValid}
          aria-describedby="new-password-rules"
          bind:value={newPassword}
        />
      </label>
      <div id="new-password-rules">
        <PasswordChecklist password={newPassword} />
      </div>

      <label>
        <span>Confirme a nova senha</span>
        <input
          class="input"
          type="password"
          autocomplete="new-password"
          required
          maxlength={PASSWORD_LENGTH.max}
          aria-invalid={showMismatch}
          aria-describedby="new-confirmation-hint"
          bind:value={confirmation}
        />
        {#if showMismatch}
          <small id="new-confirmation-hint" class="field-error">As senhas não coincidem</small>
        {:else if confirmation && passwordsMatch}
          <small id="new-confirmation-hint" class="field-ok">As senhas coincidem</small>
        {/if}
      </label>

      {#if passwordFeedback}
        <p class="alert alert-{passwordFeedback.kind}" role="status">{passwordFeedback.text}</p>
      {/if}

      <button class="btn btn-primary" disabled={changingPassword}>
        {changingPassword ? 'Alterando…' : 'Alterar senha'}
      </button>
    </form>
  </div>
{/if}

<style>
  .account {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    padding-top: 16px;
  }

  header {
    width: 100%;
    max-width: 480px;
  }

  h1 {
    font-size: 26px;
  }

  .account .auth-card {
    max-width: 480px;
  }

  h2 {
    font-size: 18px;
  }

  input[readonly] {
    color: var(--muted);
    cursor: default;
  }
</style>
