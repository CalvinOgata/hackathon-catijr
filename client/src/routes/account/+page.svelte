<script lang="ts">
  import {
    AUCTION_STATUS_LABELS,
    DELETE_ACCOUNT_CONFIRMATION,
    DISPLAY_NAME_LENGTH,
    normalizeDisplayName,
    PASSWORD_LENGTH,
    passwordProblems,
    type AccountDeletionBlockers,
  } from '@auction/shared';
  import { goto } from '$app/navigation';
  import { ApiError, api } from '#lib/api.ts';
  import { auth } from '#lib/auth.svelte.ts';
  import PasswordChecklist from '#lib/components/PasswordChecklist.svelte';
  import { formatDate } from '#lib/format.ts';

  type Feedback = { kind: 'error' | 'success'; text: string } | null;

  /** Set right after deleting the account, so we go home instead of to the login page. */
  let deleted = false;

  // The account page requires login
  $effect(() => {
    if (auth.ready && !auth.user && !deleted) goto('/login?redirect=/account', { replace: true });
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

  // --- Delete account
  let blockers = $state<AccountDeletionBlockers | null>(null);
  let blockersError = $state<string | null>(null);
  let deletePassword = $state('');
  let deleteConfirmation = $state('');
  let deleting = $state(false);
  let deleteError = $state<string | null>(null);

  const userId = $derived(auth.user?.id);
  const blocked = $derived(!!blockers && (blockers.auctions.length > 0 || blockers.bids.length > 0));
  const canSubmitDelete = $derived(!!deletePassword && deleteConfirmation === DELETE_ACCOUNT_CONFIRMATION && !deleting);

  async function loadBlockers() {
    blockersError = null;
    try {
      blockers = await api.get<AccountDeletionBlockers>('/account/deletion-check');
    } catch (err) {
      blockersError = (err as Error).message;
    }
  }

  $effect(() => {
    if (userId !== undefined) loadBlockers();
  });

  async function deleteAccount(event: SubmitEvent) {
    event.preventDefault();
    deleting = true;
    deleteError = null;
    try {
      deleted = true;
      await auth.deleteAccount(deletePassword, deleteConfirmation);
      await goto('/', { replace: true });
    } catch (err) {
      deleted = false;
      deleteError = (err as Error).message;
      // Something new is open (e.g. a bid placed in another tab): show the updated list
      if (err instanceof ApiError && err.status === 409) await loadBlockers();
    } finally {
      deleting = false;
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

    <section class="auth-card danger-zone" aria-labelledby="delete-title">
      <div>
        <h2 id="delete-title">Excluir conta</h2>
        <p class="muted">
          Você sai de todos os dispositivos e não poderá mais entrar com esta conta. Os leilões e lances que você já fez
          continuam no histórico, sem o seu nome (aparecem como “Conta excluída”). Não dá para desfazer.
        </p>
      </div>

      {#if blockersError}
        <p class="alert alert-error">{blockersError}</p>
      {:else if !blockers}
        <p class="muted small">Verificando se a conta pode ser excluída…</p>
      {:else if blocked}
        <div class="blockers">
          <p><strong>Antes de excluir a conta, nada pode estar em aberto:</strong></p>
          {#if blockers.auctions.length}
            <p class="muted small">Seus leilões ainda ativos. Cancele os agendados ou sem lances, ou aguarde o fim deles:</p>
            <ul>
              {#each blockers.auctions as auction (auction.id)}
                <li><a href="/auctions/{auction.id}">{auction.title}</a> · {AUCTION_STATUS_LABELS[auction.status]}</li>
              {/each}
            </ul>
          {/if}
          {#if blockers.bids.length}
            <p class="muted small">Leilões em andamento em que você deu lances. Aguarde o fim deles:</p>
            <ul>
              {#each blockers.bids as auction (auction.id)}
                <li><a href="/auctions/{auction.id}">{auction.title}</a></li>
              {/each}
            </ul>
          {/if}
          <button class="btn btn-ghost refresh" type="button" onclick={loadBlockers}>Verificar novamente</button>
        </div>
      {:else}
        <form onsubmit={deleteAccount}>
          <label>
            <span>Sua senha</span>
            <input class="input" type="password" autocomplete="current-password" required maxlength={PASSWORD_LENGTH.max} bind:value={deletePassword} />
          </label>

          <label>
            <span>Digite <strong>{DELETE_ACCOUNT_CONFIRMATION}</strong> para confirmar</span>
            <input class="input" autocomplete="off" autocapitalize="characters" spellcheck="false" required bind:value={deleteConfirmation} />
          </label>

          {#if deleteError}
            <p class="alert alert-error" role="alert">{deleteError}</p>
          {/if}

          <button class="btn danger" disabled={!canSubmitDelete}>{deleting ? 'Excluindo…' : 'Excluir minha conta'}</button>
        </form>
      {/if}
    </section>
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

  .danger-zone {
    border-color: color-mix(in srgb, var(--red) 40%, var(--border));
  }

  .danger-zone form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .danger {
    height: 46px;
    background: var(--red);
    color: #fff;
  }

  .small {
    font-size: 13px;
  }

  .blockers {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    background: var(--surface-2);
    border-radius: 10px;
    font-size: 14px;
  }

  .blockers ul {
    margin: 0;
    padding-left: 20px;
  }

  .blockers a {
    color: var(--accent);
    font-weight: 600;
  }

  .refresh {
    align-self: flex-start;
    height: 34px;
    padding: 0 12px;
    font-size: 13px;
  }

  input[readonly] {
    color: var(--muted);
    cursor: default;
  }
</style>
