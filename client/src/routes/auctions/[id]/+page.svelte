<script lang="ts">
  import type { Auction } from '@auction/shared';
  import { page } from '$app/state';
  import { api } from '#lib/api.ts';
  import { auth } from '#lib/auth.svelte.ts';
  import AuctionHero from '#lib/components/AuctionHero.svelte';
  import { AuctionRoom } from '#lib/room.svelte.ts';
  import { socket } from '#lib/socket.svelte.ts';

  let auction = $state<Auction | null>(null);
  let error = $state<string | null>(null);
  let room = $state<AuctionRoom | null>(null);

  const id = $derived(Number(page.params.id));
  const userId = $derived(auth.user?.id);

  // The listing itself is public
  $effect(() => {
    const auctionId = id;
    let cancelled = false;
    auction = null;
    error = null;

    api
      .get<Auction>(`/auctions/${auctionId}`)
      .then((result) => !cancelled && (auction = result))
      .catch((err) => !cancelled && (error = err.message));

    return () => (cancelled = true);
  });

  // The room (live bids, bidding) requires login (RF04)
  $effect(() => {
    if (userId === undefined) {
      room = null;
      return;
    }
    const current = new AuctionRoom(id);
    room = current;
    return () => current.leave();
  });

  $effect(() => {
    const onUpdated = (update: Auction) => {
      if (update.id === id) auction = update;
    };
    socket.on('auction:updated', onUpdated);
    return () => socket.off('auction:updated', onUpdated);
  });
</script>

<svelte:head>
  <title>{auction ? `${auction.title} · Arremate` : 'Arremate'}</title>
</svelte:head>

<a href="/" class="back muted">← Todos os leilões</a>

{#if error}
  <p class="alert alert-error">{error}</p>
{:else if auction}
  <AuctionHero {auction} {room} />
{/if}

<style>
  .back {
    display: inline-block;
    margin-bottom: 16px;
    font-weight: 600;
  }

  .back:hover {
    color: var(--text);
  }
</style>
