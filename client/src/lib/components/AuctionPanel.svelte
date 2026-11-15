<script lang="ts">
  import { AUCTION_STATUS_LABELS, auctionStatus, type Auction } from '@auction/shared';
  import { page } from '$app/state';
  import { auth } from '#lib/auth.svelte.ts';
  import { clock } from '#lib/clock.svelte.ts';
  import { formatDateTime, formatDuration, formatMoney, formatTime, formatTimeAgo } from '#lib/format.ts';
  import type { AuctionRoom } from '#lib/room.svelte.ts';
  import { loadRules } from '#lib/rules.ts';
  import { flash } from '#lib/transitions.ts';
  import BidForm from './BidForm.svelte';
  import CancelAuction from './CancelAuction.svelte';
  import Countdown from './Countdown.svelte';

  // The auction's prices, time and outcome, and its live room: who leads, the headcount, bidding and the last bids.
  interface Props {
    auction: Auction;
    /** The live room, when the user is logged in (RF04). */
    room: AuctionRoom | null;
  }

  let { auction, room }: Props = $props();

  const isSeller = $derived(auth.user?.id === auction.sellerId);
  // Who leads is only known inside the room (RF04): public listing data has no bidder information
  const leader = $derived(room?.joined && room.auction?.id === auction.id ? room.leader : null);
  const isLeader = $derived(!!room?.isMine(leader));
  const here = $derived(encodeURIComponent(page.url.pathname + page.url.search));
  const status = $derived(auctionStatus(auction, clock.now));
  const scheduled = $derived(status === 'scheduled');
  const over = $derived(status !== 'scheduled' && status !== 'live');
  const isWinner = $derived(status === 'sold' && isLeader);
  /** RF25: true when the connected user is in the room but only as a spectator. */
  const isSpectator = $derived(room?.joined === true && room?.mode === 'spectator');

  let upgrading = $state(false);
  let upgradeError = $state<string | null>(null);

  async function handleUpgrade() {
    if (!room || upgrading) return;
    upgrading = true;
    upgradeError = await room.upgrade();
    upgrading = false;
  }

  // RF15: the extension rule, shown while the auction is live, and whether late bids moved the end
  let extension = $state<{ windowMinutes: number; maxMinutes: number } | null>(null);
  loadRules()
    .then((rules) => (extension = rules.extension))
    .catch(() => {}); // only the explanation is missing
  const extended = $derived(auction.endsAt !== auction.originalEndsAt);
</script>

<aside class="panel">
  <div class="stats">
    <div class="current">
      <span class="label">{auction.bidCount ? 'Lance atual' : 'Preço inicial'}</span>
      {#key auction.currentPrice}
        <strong class="price" in:flash>{formatMoney(auction.currentPrice)}</strong>
      {/key}
      <span class="muted small">{auction.bidCount} {auction.bidCount === 1 ? 'lance' : 'lances'}</span>
    </div>
    {#if !over}
      <div class="stats-min">
        <span class="label">Mín. próximo lance</span>
        <strong class="min-price">{formatMoney(auction.minBid)}</strong>
        <span class="muted small">+{formatMoney(auction.minIncrement)} mín.</span>
      </div>
    {/if}
    <div class="ends">
      {#if over}
        <span class="label">Situação</span>
        <strong class="status status-{status}">{AUCTION_STATUS_LABELS[status]}</strong>
      {:else}
        <span class="label">{scheduled ? 'Começa em' : 'Termina em'}</span>
        <strong class:starting={scheduled}><Countdown until={scheduled ? auction.startsAt : auction.endsAt} warn={!scheduled} /></strong>
        {#if extended}
          <span class="extended small" title="Término original: {formatDateTime(auction.originalEndsAt)}">
            Prorrogado · era {formatTime(auction.originalEndsAt)}
          </span>
        {/if}
      {/if}
    </div>
  </div>
  {#if status === 'live' && extension}
    <p class="rule muted small">
      Lances nos últimos {formatDuration(extension.windowMinutes)} prorrogam o término para {formatDuration(extension.windowMinutes)}
      após o lance, até {formatDuration(extension.maxMinutes)} além do horário original.
    </p>
  {/if}

  {#if status === 'sold'}
    <div class="outcome outcome-sold" in:flash>
      <span class="outcome-trophy">🏆</span>
      <div>
        <strong>Leilão Vendido</strong>
        <p class="small">
          {#if leader}Vencedor: <strong>{isWinner ? 'Você!' : leader.bidderName}</strong> por{:else}Arrematado por{/if}
          <strong>{formatMoney(auction.currentPrice)}</strong>
        </p>
      </div>
    </div>
  {:else if status === 'unsold'}
    <div class="outcome outcome-unsold">
      <strong>Encerrado sem lances</strong>
      <p class="muted small">O leilão atingiu o horário de término sem ofertas registradas.</p>
    </div>
  {:else if status === 'live' && room?.joined}
    <div class="leader-banner" class:is-user-leader={isLeader}>
      <span class="leader-icon">{isLeader ? '⭐' : '👤'}</span>
      <div class="leader-text">
        <span class="label">{isLeader ? 'Sua liderança' : 'Líder atual'}</span>
        <strong>
          {#if auction.bidCount === 0}
            Nenhum lance ainda
          {:else if isLeader}
            Você está na liderança ({formatMoney(auction.currentPrice)})
          {:else}
            {leader?.bidderName} ({formatMoney(auction.currentPrice)})
          {/if}
        </strong>
      </div>
    </div>
  {/if}

  {#if status === 'cancelled'}
    <p class="note cancelled">
      Leilão cancelado pelo anunciante em <strong>{formatDateTime(auction.cancelledAt!)}</strong>. Ele não recebe mais lances.
    </p>
  {:else if scheduled}
    <p class="note">
      Leilão agendado: abre em <strong>{formatDateTime(auction.startsAt)}</strong> e termina em
      <strong>{formatDateTime(auction.endsAt)}</strong>.
    </p>
  {/if}

  {#if !auth.user}
    <div class="gate">
      <p><strong>A sala do leilão é exclusiva para membros.</strong></p>
      <p class="muted small">Entre para acompanhar os lances ao vivo e dar os seus.</p>
      <a class="btn btn-primary full" href="/login?redirect={here}">Entrar para acessar a sala</a>
      <a class="btn btn-ghost full" href="/signup?redirect={here}">Criar conta</a>
    </div>
  {:else if room?.error}
    <p class="alert alert-error">{room.error}</p>
  {:else if !room?.joined}
    <p class="muted small">Entrando na sala do leilão…</p>
  {:else}
    <!-- RF25: presence badge -->
    <div class="presence-badge">
      <span class="presence-icon">👥</span>
      <span>
        {room.participants} {room.participants === 1 ? 'participante' : 'participantes'}
        · {room.spectators} {room.spectators === 1 ? 'espectador' : 'espectadores'}
      </span>
    </div>

    {#if isSeller}
      {#if !over}
        <p class="note">Este leilão é seu. Você não pode dar lances no próprio leilão.</p>
      {/if}
      <CancelAuction {auction} />
    {:else if status === 'cancelled'}
      <!-- The note above already explains it -->
    {:else if scheduled}
      <p class="muted small">Os lances abrem quando o leilão começar.</p>
    {:else}
      <!-- RF25: spectators watch; becoming a participant (who can bid) doesn't leave the room -->
      {#if isSpectator && status === 'live'}
        <div class="spectator-gate">
          <p class="small"><strong>Você está assistindo como espectador.</strong></p>
          <p class="muted small">Clique abaixo para participar e dar lances.</p>
          <button class="btn btn-primary full" onclick={handleUpgrade} disabled={upgrading}>
            {upgrading ? 'Entrando…' : '🎯 Participar do leilão'}
          </button>
          {#if upgradeError}
            <p class="field-error" role="alert">{upgradeError}</p>
          {/if}
        </div>
      {:else}
        {#key auction.id}
          <BidForm {auction} leading={isLeader} />
        {/key}
      {/if}
    {/if}

    <section class="history">
      <h3>Últimos lances</h3>
      {#if room.bids.length}
        <ul>
          {#each room.bids as bid (bid.id)}
            <li in:flash class:my-bid={room.isMine(bid)}>
              <span class="bidder">
                {bid.bidderName}
                {#if room.isMine(bid)}
                  <span class="you-pill">Você</span>
                {/if}
              </span>
              <span class="amount">{formatMoney(bid.amount)}</span>
              <span class="muted small">{formatTimeAgo(bid.createdAt, clock.now)}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted small">{over ? 'Nenhum lance.' : `Nenhum lance ainda.${isSeller ? '' : ' Seja o primeiro!'}`}</p>
      {/if}
    </section>
  {/if}
</aside>

<style>
  .starting {
    color: var(--accent);
  }

  .status {
    font-size: 16px;
  }

  .status-sold {
    color: var(--green);
  }

  .status-unsold,
  .status-cancelled {
    color: var(--muted);
  }

  .note.cancelled {
    background: var(--surface-2);
    color: var(--muted);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-width: 0;
    container-type: inline-size;
  }

  /* Narrow panel (desktop side column, phones): the price on its own row, then the minimum
     bid and the countdown side by side. Wide panel (tablets): all three in one row. */
  .stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 16px;
    padding: 16px;
    background: var(--surface-2);
    border-radius: 12px;
  }

  .stats > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .current {
    grid-column: 1 / -1;
  }

  .ends {
    grid-column: -2;
    text-align: right;
    align-items: flex-end;
  }

  .ends strong {
    font-size: 20px;
    line-height: 1.2;
  }

  .extended {
    color: var(--accent);
    font-weight: 600;
  }

  .rule {
    margin: -12px 0 0;
    padding: 0 4px;
  }

  @container (min-width: 560px) {
    .stats {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .current {
      grid-column: auto;
    }
  }

  .label {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .price {
    margin: 0 -4px;
    padding: 0 4px;
    border-radius: 6px;
    font-size: clamp(24px, 9cqi, 30px);
    overflow-wrap: anywhere;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }

  .small {
    font-size: 13px;
  }

  .stats-min strong {
    font-size: 20px;
    line-height: 1.2;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  .outcome {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 12px;
  }

  .outcome-sold {
    background: color-mix(in srgb, var(--green, #22c55e) 15%, var(--surface-2));
    border: 1px solid color-mix(in srgb, var(--green, #22c55e) 40%, var(--border));
  }

  .outcome-unsold {
    background: var(--surface-2);
    border: 1px solid var(--border);
  }

  .outcome-trophy {
    font-size: 28px;
  }

  .leader-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    transition: background 0.2s, border-color 0.2s;
  }

  .leader-banner.is-user-leader {
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  }

  .leader-icon {
    font-size: 20px;
  }

  .leader-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .leader-text strong {
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .you-pill {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    background: var(--accent);
    color: white;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
  }

  .my-bid {
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }

  .gate {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border: 1px dashed var(--border);
    border-radius: 12px;
  }

  .gate .small {
    margin-bottom: 4px;
  }

  .full {
    width: 100%;
    height: 44px;
  }

  .note {
    padding: 12px 14px;
    background: var(--accent-soft);
    color: var(--accent);
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
  }

  .history h3 {
    margin-bottom: 8px;
    font-size: 14px;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 220px;
    overflow-y: auto;
  }

  li {
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 8px;
    padding: 8px;
    border-radius: 8px;
    border-bottom: 1px solid var(--border);
  }

  li:last-child {
    border-bottom: none;
  }

  .bidder {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .amount {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .spectator-gate {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border: 1px dashed var(--accent);
    border-radius: 12px;
    background: var(--accent-soft);
  }

  .spectator-gate .small {
    margin-bottom: 4px;
  }

  .presence-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 13px;
    color: var(--muted);
    font-weight: 500;
  }

  .presence-icon {
    font-size: 15px;
  }
</style>
