// RF15 (extension), RF17/RF18 (open/close, restarts) and RF20 (listing). Phases:
//   main      server running: extension rules, listing, closing live
//   down      server stopped: nothing (the script just waits for the start/end times to pass)
//   after     server started again: what opened/closed while it was down, no double close
// The extension cap is set to 3 s (see run.mjs), to reach it quickly.
import { readFileSync } from 'node:fs';
import { URL, LOG, phase, check, finish, sleep, json, api, PNG, saveState, loadState, io } from './lib.mjs';

const signup = async (name, email) => (await api('POST', '/auth/signup', { name, email, password: 'Segura#2026' })).body.token;
const connect = (token) => new Promise((res) => { const s = io(URL, { auth: token ? { token } : {}, forceNew: true }); s.updates = []; s.on('auction:updated', (a) => s.updates.push(a)); s.on('connect', () => res(s)); });
function create(token, fields = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ title: 'Leilão de teste', description: 'Descrição do item de teste.', category: 'Outros', startingPrice: '1000', durationMinutes: '1', ...fields })) form.append(k, v);
  for (let i = 0; i < 3; i++) form.append('photos', new Blob([PNG]), 'p.png');
  return fetch(`${URL}/api/auctions`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }).then(json).then((r) => r.body);
}
const get = async (id) => (await api('GET', `/auctions/${id}`)).body;
const listIds = async () => (await api('GET', '/auctions?limit=50')).body.auctions.map((a) => a.id);
const logCount = (msg, id) => readFileSync(LOG, 'utf8').split('\n').filter((l) => l.includes(`"msg":"${msg}"`) && l.includes(`"auctionId":${id},`)).length;

if (phase === 'main') {
  const seller = await signup('Sofia Vendedora', 'sofia@test.com');
  const ana = await signup('Ana Souza', 'ana@test.com');
  const beto = await signup('Beto Lima', 'beto@test.com');
  const as = await connect(ana);
  const bs = await connect(beto);
  const guest = await connect();

  console.log('== RF15 · extension');
  const a = await create(seller, { title: 'Prorrogação' });
  for (const s of [as, bs]) await s.emitWithAck('room:join', a.id, 'participant');
  const original = Date.parse(a.endsAt);
  check('a new auction ends at its original end', a.endsAt === a.originalEndsAt);
  let r = await as.emitWithAck('bid:place', { auctionId: a.id, amount: 1000, idempotencyKey: 'a1' });
  const extendedTo = Date.parse(r.auction.endsAt);
  const bidAt = Date.parse(r.bid.createdAt);
  check('a bid with less than the window left moves the end to one window after the bid', extendedTo === bidAt + 60_000, `+${(extendedTo - original) / 1000}s over the original`);
  check('…and keeps the original end', r.auction.originalEndsAt === a.originalEndsAt);
  await sleep(150);
  check('everyone (even guests) gets the new end', guest.updates.some((u) => u.id === a.id && u.endsAt === r.auction.endsAt));
  for (let i = 0; i < 6; i++) {
    await sleep(600);
    const s = i % 2 ? as : bs;
    r = await s.emitWithAck('bid:place', { auctionId: a.id, amount: r.auction.minBid, idempotencyKey: `x${i}` });
  }
  const capped = Date.parse(r.auction.endsAt);
  check('extensions stop at the cap (original + 3 s)', capped === original + 3000, `+${(capped - original) / 1000}s`);
  check('every bid was accepted', r.ok && r.auction.bidCount === 7, r.error);

  const noExt = await create(seller, { title: 'Sem prorrogação', durationMinutes: '3' });
  await as.emitWithAck('room:join', noExt.id, 'participant');
  await sleep(600);
  r = await as.emitWithAck('bid:place', { auctionId: noExt.id, amount: 1000, idempotencyKey: 'n1' });
  check('a bid with more than the window left doesn\'t extend', r.ok && r.auction.endsAt === noExt.endsAt);

  console.log('\n== RF20 · listing');
  const scheduledSoon = await create(seller, { title: 'Abre durante a parada', startsAt: new Date(Date.now() + 75_000).toISOString(), durationMinutes: '3' });
  const endsDuringDowntime = await create(seller, { title: 'Fecha durante a parada' });
  await as.emitWithAck('room:join', endsDuringDowntime.id, 'participant');
  await sleep(600);
  await as.emitWithAck('bid:place', { auctionId: endsDuringDowntime.id, amount: 1000, idempotencyKey: 'd1' });
  const cancelled = await create(seller, { title: 'Cancelado' });
  await api('POST', `/auctions/${cancelled.id}/cancel`, null, seller);
  let ids = await listIds();
  check('scheduled and live auctions are listed, cancelled ones are not', ids.includes(scheduledSoon.id) && ids.includes(a.id) && !ids.includes(cancelled.id));
  const page = (await api('GET', '/auctions?limit=2')).body;
  const page2 = (await api('GET', '/auctions?limit=2&offset=2')).body;
  check('pages: limit and offset, with the total', page.auctions.length === 2 && page.total === ids.length && page2.auctions[0].id === ids[2]);
  check('the cancelled auction is still reachable by its link', (await get(cancelled.id)).cancelledAt !== null);

  console.log('\n== RF17 · closes by itself, live');
  const wait = Date.parse((await get(a.id)).endsAt) - Date.now() + 1500;
  console.log(`   (waiting ${Math.round(wait / 1000)}s for the extended end)`);
  await sleep(wait);
  r = await bs.emitWithAck('bid:place', { auctionId: a.id, amount: 100_000, idempotencyKey: 'late' });
  check('a bid after the end is refused', !r.ok && r.code === 'NOT_IN_PROGRESS', r.error);
  const closedUpdate = guest.updates.filter((u) => u.id === a.id).at(-1);
  check('the close was announced to everyone', !!closedUpdate && Date.parse(closedUpdate.endsAt) <= Date.now());
  check('closed exactly once (log)', logCount('Auction closed', a.id) === 1);
  const final = await get(a.id);
  check('it ended sold, to the highest bid', final.bidCount === 7 && final.currentPrice === r.currentMinBid - final.minIncrement);
  ids = await listIds();
  check('it left the listing', !ids.includes(a.id));

  for (const s of [as, bs, guest]) s.close();
  saveState({ a: a.id, scheduledSoon: scheduledSoon.id, endsDuringDowntime: endsDuringDowntime.id, startsAt: scheduledSoon.startsAt, endsAt: endsDuringDowntime.endsAt });
} else if (phase === 'down') {
  const { startsAt, endsAt } = loadState();
  const wait = Math.max(Date.parse(startsAt), Date.parse(endsAt)) - Date.now() + 1500;
  console.log(`   (server down; waiting ${Math.max(0, Math.round(wait / 1000))}s for a start and an end to pass)`);
  if (wait > 0) await sleep(wait);
} else {
  const { a, scheduledSoon, endsDuringDowntime } = loadState();
  console.log('\n== RF18 · after a restart');
  check('what should have opened while down opened on start (once)', logCount('Auction opened', scheduledSoon) === 1);
  check('what should have closed while down closed on start (once)', logCount('Auction closed', endsDuringDowntime) === 1);
  const ended = await get(endsDuringDowntime.id ?? endsDuringDowntime);
  check('…as sold, with its bid', ended.bidCount === 1);
  const ids = await listIds();
  check('the listing reflects both', ids.includes(scheduledSoon) && !ids.includes(endsDuringDowntime));
  check('the auction closed before the restart wasn\'t closed again', logCount('Auction closed', a) === 1);
}

finish();
