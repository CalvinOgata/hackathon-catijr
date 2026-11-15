<script lang="ts">
  import { DISPLAY_NAME_LENGTH } from '@auction/shared';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth } from '#lib/auth.svelte.ts';
  import NewPassword, { newPasswordProblem } from '#lib/components/NewPassword.svelte';
  import TaskMessage from '#lib/components/TaskMessage.svelte';
  import { safeRedirect } from '#lib/format.ts';
  import { Task } from '#lib/task.svelte.ts';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let confirmation = $state('');
  let attempted = $state(false);
  const signup = new Task();

  const redirect = $derived(safeRedirect(page.url.searchParams.get('redirect')));

  function submit(event: SubmitEvent) {
    event.preventDefault();
    attempted = true;
    const problem = newPasswordProblem(password, confirmation);
    if (problem) return signup.fail(problem);
    signup.run(async () => {
      await auth.signup(name, email, password);
      await goto(redirect);
    });
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

    <NewPassword bind:password bind:confirmation {attempted} />

    <TaskMessage task={signup} />

    <button class="btn btn-primary" disabled={signup.pending}>{signup.pending ? 'Criando conta…' : 'Criar conta'}</button>

    <p class="muted switch">
      Já tem uma conta? <a href="/login?redirect={encodeURIComponent(redirect)}">Entrar</a>
    </p>
  </form>
</div>
