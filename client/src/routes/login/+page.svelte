<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth } from '#lib/auth.svelte.ts';
  import TaskMessage from '#lib/components/TaskMessage.svelte';
  import { safeRedirect } from '#lib/format.ts';
  import { Task } from '#lib/task.svelte.ts';

  let email = $state('');
  let password = $state('');
  const login = new Task();

  const redirect = $derived(safeRedirect(page.url.searchParams.get('redirect')));

  function submit(event: SubmitEvent) {
    event.preventDefault();
    login.run(async () => {
      await auth.login(email, password);
      await goto(redirect);
    });
  }
</script>

<svelte:head>
  <title>Entrar · Arremate</title>
</svelte:head>

<div class="auth-page">
  <form class="auth-card" onsubmit={submit}>
    <div>
      <h1>Entrar na sua conta</h1>
      <p class="muted">Entre para dar lances nos leilões ao vivo.</p>
    </div>

    <label>
      <span>E-mail</span>
      <input class="input" type="email" autocomplete="email" required bind:value={email} />
    </label>

    <label>
      <span>Senha</span>
      <input class="input" type="password" autocomplete="current-password" required bind:value={password} />
    </label>

    <TaskMessage task={login} />

    <button class="btn btn-primary" disabled={login.pending}>{login.pending ? 'Entrando…' : 'Entrar'}</button>

    <p class="muted switch">
      Ainda não tem conta? <a href="/signup?redirect={encodeURIComponent(redirect)}">Criar conta</a>
    </p>
  </form>
</div>
