<script lang="ts">
  import { AUCTION_STATUS_LABELS, DELETE_ACCOUNT_CONFIRMATION, DISPLAY_NAME_LENGTH, normalizeDisplayName, PASSWORD_LENGTH, type AccountDeletionBlockers } from '@auction/shared';
  import { goto } from '$app/navigation';
  import { ApiError, api } from '#lib/api.ts';
  import { auth, requireLogin } from '#lib/auth.svelte.ts';
  import NewPassword, { newPasswordProblem } from '#lib/components/NewPassword.svelte';
  import TaskMessage from '#lib/components/TaskMessage.svelte';
  import { formatDate } from '#lib/format.ts';
  import { Task } from '#lib/task.svelte.ts';

  /** Set right after deleting the account, so we go home instead of to the login page. */
  let deleted = false;
  requireLogin(() => deleted);

  // --- Display name
  let name = $state(auth.user?.name ?? '');
  const saveName = new Task();

  // Fill the field once the session is restored (e.g. when opening this page directly)
  $effect(() => {
    if (auth.user && !name) name = auth.user.name;
  });

  const nameChanged = $derived(!!auth.user && normalizeDisplayName(name) !== auth.user.name);

  async function submitName(event: SubmitEvent) {
    event.preventDefault();
    if (await saveName.run(() => auth.updateName(name), 'Nome atualizado.')) name = auth.user!.name;
  }

  // --- Password
  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmation = $state('');
  let attempted = $state(false);
  const changePassword = new Task();

  async function submitPassword(event: SubmitEvent) {
    event.preventDefault();
    attempted = true;
    const problem = newPasswordProblem(newPassword, confirmation);
    if (problem) return changePassword.fail(problem);
    const done = await changePassword.run(
      () => auth.changePassword(currentPassword, newPassword),
      'Senha alterada. Suas outras sessões foram encerradas.',
    );
    if (done) {
      currentPassword = newPassword = confirmation = '';
      attempted = false;
    }
  }

  // --- Delete account
  let blockers = $state<AccountDeletionBlockers | null>(null);
  let blockersError = $state<string | null>(null);
  let deletePassword = $state('');
  let deleteConfirmation = $state('');
  const deleteAccount = new Task();

  const userId = $derived(auth.user?.id);
  const blocked = $derived(!!blockers && (blockers.auctions.length > 0 || blockers.bids.length > 0));
  const canSubmitDelete = $derived(!!deletePassword && deleteConfirmation === DELETE_ACCOUNT_CONFIRMATION && !deleteAccount.pending);

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

  function submitDelete(event: SubmitEvent) {
    event.preventDefault();
    deleteAccount.run(async () => {
      deleted = true;
      try {
        await auth.deleteAccount(deletePassword, deleteConfirmation);
      } catch (err) {
        deleted = false;
        // Something new is open (e.g. a bid placed in another tab): show the updated list
        if (err instanceof ApiError && err.status === 409) await loadBlockers();
        throw err;
      }
      await goto('/', { replace: true });
    });
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

    <form class="auth-card" onsubmit={submitName}>
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

      <TaskMessage task={saveName} />

      <button class="btn btn-primary" disabled={saveName.pending || !nameChanged}>
        {saveName.pending ? 'Salvando…' : 'Salvar nome'}
      </button>
    </form>

    <form class="auth-card" onsubmit={submitPassword}>
      <div>
        <h2>Alterar senha</h2>
        <p class="muted">Ao alterar a senha, você continua conectado aqui e sai dos outros dispositivos.</p>
      </div>

      <label>
        <span>Senha atual</span>
        <input class="input" type="password" autocomplete="current-password" required maxlength={PASSWORD_LENGTH.max} bind:value={currentPassword} />
      </label>

      <NewPassword bind:password={newPassword} bind:confirmation {attempted} label="Nova senha" />

      <TaskMessage task={changePassword} />

      <button class="btn btn-primary" disabled={changePassword.pending}>
        {changePassword.pending ? 'Alterando…' : 'Alterar senha'}
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
        <form onsubmit={submitDelete}>
          <label>
            <span>Sua senha</span>
            <input class="input" type="password" autocomplete="current-password" required maxlength={PASSWORD_LENGTH.max} bind:value={deletePassword} />
          </label>

          <label>
            <span>Digite <strong>{DELETE_ACCOUNT_CONFIRMATION}</strong> para confirmar</span>
            <input class="input" autocomplete="off" autocapitalize="characters" spellcheck="false" required bind:value={deleteConfirmation} />
          </label>

          <TaskMessage task={deleteAccount} />

          <button class="btn danger" disabled={!canSubmitDelete}>{deleteAccount.pending ? 'Excluindo…' : 'Excluir minha conta'}</button>
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
