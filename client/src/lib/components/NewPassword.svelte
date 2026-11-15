<script lang="ts" module>
  import { PASSWORD_LENGTH, passwordProblems } from '@auction/shared';

  /** Why a new password can't be sent yet, or null. The server checks the policy again. */
  export function newPasswordProblem(password: string, confirmation: string): string | null {
    if (passwordProblems(password).length) return 'A senha ainda não atende a todos os requisitos.';
    if (password !== confirmation) return 'As senhas não coincidem.';
    return null;
  }
</script>

<script lang="ts">
  import PasswordChecklist from './PasswordChecklist.svelte';

  interface Props {
    password: string;
    confirmation: string;
    /** Problems are pointed out once the user tried to submit (or finished typing the confirmation). */
    attempted: boolean;
    label?: string;
  }

  let { password = $bindable(), confirmation = $bindable(), attempted, label = 'Senha' }: Props = $props();

  const id = $props.id();
  const matches = $derived(password === confirmation);
  const showMismatch = $derived(!matches && (attempted || confirmation.length >= password.length));
</script>

<label>
  <span>{label}</span>
  <input
    class="input"
    type="password"
    autocomplete="new-password"
    required
    maxlength={PASSWORD_LENGTH.max}
    aria-invalid={attempted && passwordProblems(password).length > 0}
    aria-describedby="{id}-rules"
    bind:value={password}
  />
</label>
<div id="{id}-rules">
  <PasswordChecklist {password} />
</div>
<label>
  <span>Confirme a {label.toLowerCase()}</span>
  <input
    class="input"
    type="password"
    autocomplete="new-password"
    required
    maxlength={PASSWORD_LENGTH.max}
    aria-invalid={showMismatch}
    aria-describedby="{id}-confirmation"
    bind:value={confirmation}
  />
  {#if showMismatch}
    <small id="{id}-confirmation" class="field-error">As senhas não coincidem</small>
  {:else if confirmation && matches}
    <small id="{id}-confirmation" class="field-ok">As senhas coincidem</small>
  {/if}
</label>
