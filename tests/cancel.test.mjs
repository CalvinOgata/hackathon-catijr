// RF08: cancelling auctions: who can, when, bids and cancellations arriving together, and
// nothing deleted. The "age" phase moves an auction's end into the past while the server is stopped.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { URL, DATA, phase, check, finish, sleep, json, api, connect, PNG, saveState, loadState } from './lib.mjs';

const cancel = (id, token) => api('POST', `/auctions/${id}/cancel`, null, token);
function create(token, fields = {}) {
  const form = new FormData();
  const all = { title: 'Item de teste', description: 'Descrição do item de teste.', category: 'Outros', startingPrice: '1000', minIncrement: '100', durationMinutes: '60', ...fields };
  for (const [k, v] of Object.entries(all)) form.append(k, v);
  for (let i = 0; i < 3; i++) form.append('photos', new Blob([PNG]), 'p.png');
  return fetch(`${URL}/api/auctions`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }).then(json).then((r) => r.body);
}

if (phase === 'main') {
  const seller = (await api('POST', '/auth/signup', { name: 'Sara Vendedora', email: 'sara@test.com', password: 'Segura#2026' })).body.token;
  const buyer = (await api('POST', '/auth/signup', { name: 'Beto Comprador', email: 'beto@test.com', password: 'Segura#2026' })).body.token;

  const scheduled = await create(seller, { title: 'Agendado', startsAt: new Date(Date.now() + 3600_000).toISOString() });
  const liveNoBids = await create(seller, { title: 'Em andamento sem lances' });
  const liveWithBids = await create(seller, { title: 'Em andamento com lances' });
  const toEnd = await create(seller, { title: 'Vai terminar' });

  console.log('\n== Who can cancel');
  check('guest → 401', (await cancel(scheduled.id)).status === 401);
  let r = await cancel(scheduled.id, buyer);
  check('another user → 403', r.status === 403, r.body.message);
  r = await cancel(9999, seller);
  check('unknown auction → 404', r.status === 404, r.body.message);

  console.log('\n== Scheduled');
  const guest = await connect();
  const updates = [];
  guest.on('auction:updated', (a) => updates.push(a));
  r = await cancel(scheduled.id, seller);
  check('seller cancels a scheduled auction', r.status === 200 && !!r.body.cancelledAt, r.body.cancelledAt);
  await sleep(150);
  check('everyone (even guests) is told right away', updates.some((a) => a.id === scheduled.id && a.cancelledAt));
  r = await cancel(scheduled.id, seller);
  check('cancelling twice → 409', r.status === 409, r.body.message);

  console.log('\n== Live without bids');
  const buyerSocket = await connect(buyer);
  const roomUpdates = [];
  buyerSocket.on('auction:updated', (a) => roomUpdates.push(a));
  await buyerSocket.emitWithAck('room:join', liveNoBids.id, 'participant');
  r = await cancel(liveNoBids.id, seller);
  check('seller cancels a live auction with no bids', r.status === 200);
  await sleep(150);
  check('people in its room see it too', roomUpdates.some((a) => a.id === liveNoBids.id && a.cancelledAt));
  let bid = await buyerSocket.emitWithAck('bid:place', { auctionId: liveNoBids.id, amount: 1000 });
  check('bids on a cancelled auction are rejected', !bid.ok, bid.error);
  const join = await buyerSocket.emitWithAck('room:join', liveNoBids.id, 'participant');
  check('its room can still be opened (to see what happened)', join.ok && !!join.auction.cancelledAt);

  console.log('\n== Live with bids');
  await sleep(550); // RF13: every attempt counts, including the refused one above
  await buyerSocket.emitWithAck('room:join', liveWithBids.id, 'participant');
  bid = await buyerSocket.emitWithAck('bid:place', { auctionId: liveWithBids.id, amount: 1000 });
  check('a buyer bids', bid.ok);
  r = await cancel(liveWithBids.id, seller);
  check('auction with a bid can\'t be cancelled → 409', r.status === 409, r.body.message);

  console.log('\n== Bid and cancel at the same instant (10 rounds)');
  let consistent = 0;
  const outcomes = { bidWon: 0, cancelWon: 0 };
  for (let round = 0; round < 10; round++) {
    const a = await create(seller, { title: `Corrida ${round}` });
    await buyerSocket.emitWithAck('room:join', a.id, 'participant');
    await sleep(550); // RF13: otherwise the bid is rate limited and the race isn't tested
    // Odd rounds send the cancellation first, even rounds the bid, so both orders happen
    const placeBid = () => buyerSocket.emitWithAck('bid:place', { auctionId: a.id, amount: 1000 });
    let bidPromise, cancelPromise;
    if (round % 2) {
      cancelPromise = cancel(a.id, seller);
      await sleep(round % 3);
      bidPromise = placeBid();
    } else {
      bidPromise = placeBid();
      cancelPromise = cancel(a.id, seller);
    }
    const [bidResult, cancelResult] = await Promise.all([bidPromise, cancelPromise]);
    const final = (await api('GET', `/auctions/${a.id}`)).body;
    const oneWinner = bidResult.ok !== (cancelResult.status === 200);
    const stateMatches = bidResult.ok ? final.bidCount === 1 && !final.cancelledAt : final.bidCount === 0 && !!final.cancelledAt;
    if (oneWinner && stateMatches) consistent++;
    outcomes[bidResult.ok ? 'bidWon' : 'cancelWon']++;
  }
  check('exactly one of them wins every time, and the saved state agrees', consistent === 10, JSON.stringify(outcomes));

  console.log('\n== Nothing is deleted');
  const list = (await api('GET', '/auctions?limit=50')).body.auctions;
  check('cancelled auctions leave the public listing (RF20), live ones stay', !list.some((a) => a.cancelledAt) && list.some((a) => a.id === liveWithBids.id));
  r = await api('GET', `/auctions/${scheduled.id}`);
  check('a cancelled auction keeps all its data', r.status === 200 && r.body.title === 'Agendado' && r.body.photos.length === 3);
  const files = readdirSync(`${DATA}/photos`);
  check('its photos are still on disk', scheduled.photos.every((url) => files.includes(url.split('/').pop())));

  guest.close();
  buyerSocket.close();
  saveState({ seller, scheduledId: scheduled.id, toEndId: toEnd.id });
} else if (phase === 'age') {
  const { toEndId } = loadState();
  const file = `${DATA}/store.json`;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const auction = data.auctions.find((a) => a.id === toEndId);
  auction.startsAt = Date.now() - 2 * 3600_000;
  auction.endsAt = Date.now() - 3600_000;
  writeFileSync(file, JSON.stringify(data));
  console.log(`(moved auction ${toEndId}'s end one hour into the past)`);
} else {
  const { seller, scheduledId, toEndId } = loadState();
  console.log('\n== After restart');
  const r = await api('GET', `/auctions/${scheduledId}`);
  check('cancellation was saved', !!r.body.cancelledAt);
  const ended = await cancel(toEndId, seller);
  check('an auction that already ended can\'t be cancelled → 409', ended.status === 409, ended.body.message);
}

finish();
