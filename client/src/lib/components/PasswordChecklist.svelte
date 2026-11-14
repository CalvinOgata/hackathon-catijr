<script lang="ts">
  import { PASSWORD_RULES } from '@auction/shared';

  let { password }: { password: string } = $props();
</script>

<ul aria-label="Requisitos da senha">
  {#each PASSWORD_RULES as rule (rule.label)}
    {@const ok = rule.test(password)}
    <li class:ok>
      <span class="mark" aria-hidden="true">{ok ? '✓' : '•'}</span>
      {rule.label}
      <span class="visually-hidden">{ok ? '(atendido)' : '(pendente)'}</span>
    </li>
  {/each}
</ul>

<style>
  ul {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 12px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 12px;
    font-weight: 400;
    color: var(--muted);
  }

  li {
    display: flex;
    gap: 6px;
    transition: color 0.15s;
  }

  li.ok {
    color: var(--green);
  }

  .mark {
    width: 10px;
    font-weight: 700;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }

  @media (max-width: 480px) {
    ul {
      grid-template-columns: 1fr;
    }
  }
</style>
