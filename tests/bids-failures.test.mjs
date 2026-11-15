// Bids when things go wrong: refusals that tell the minimum (RF10), bursts (RF13), and a failed
// save to disk that must leave no trace (no ghost bid, no half-done cancel). Phases: main, after (a restart).
import { chmodSync } from 'node:fs';
import { URL, DATA, phase, check, finish, sleep, json, api, connect, PNG, saveState, loadState } from './lib.mjs';

const signup = async (name, email) => (await api('POST', '/auth/signup', { name, email, password: 'Segura#2026' })).body;
function create(token, fields = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ title: 'Item de teste', description: 'Descrição do item de teste.', category: 'Outros', startingPrice: '1000', durationMinutes: '60', ...fields })) form.append(k, v);
  for (let i = 0; i < 3; i++) form.append('photos', new Blob([PNG]), 'p.png');
  return fetch(`${URL}/api/auctions`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }).then(json).then((r) => r.body);
}
const bid = (s, auctionId, amount, idempotencyKey) => s.emitWithAck('bid:place', { auctionId, amount, ...(idempotencyKey && { idempotencyKey }) });

if (phase === 'main') {
  const seller = await signup('Vendedora', 'vendedora@test.com');
  const ana = await signup('Ana Souza', 'ana@test.com');
  const beto = await signup('Beto Lima', 'beto@test.com');
  const a = await create(seller.token, { title: 'Leilão A' });
  const b = await create(seller.token, { title: 'Leilão B' });
  const c = await create(seller.token, { title: 'Leilão C' });

  const as = await connect(ana.token);
  const bs = await connect(beto.token);
  for (const id of [a.id, b.id, c.id]) {
    await as.emitWithAck('room:join', id, 'participant');
    await bs.emitWithAck('room:join', id, 'participant');
  }

  console.log('== 4. Every attempt counts (RF13)');
  const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => bid(as, a.id, 1, `low-${i}`)));
  const codes = burst.reduce((m, x) => ((m[x.code] = (m[x.code] ?? 0) + 1), m), {});
  check('20 instant refused attempts: only the first is processed, the rest are rate limited', codes.BELOW_MINIMUM === 1 && codes.RATE_LIMITED === 19, JSON.stringify(codes));
  check('rate-limited refusals carry the minimum too', burst.every((x) => x.currentMinBid === 1000));
  await sleep(550);
  let r = await bid(as, a.id, 1000, 'a1');
  check('after 500 ms the user can bid again', r.ok, r.error);
  r = await bid(as, b.id, 1000, 'b1');
  check('a bid in another auction right after is rate limited', !r.ok && r.code === 'RATE_LIMITED', r.error);
  r = await bid(bs, b.id, 1000, 'beto-b1');
  check('…but another user is not slowed down by it', r.ok, r.error);
  r = await bid(as, a.id, 1000, 'a1');
  check('re-sending the bid just made (same key) is not rate limited and returns the original', r.ok && r.bid.amount === 1000);
  await sleep(550);
  r = await bid(as, c.id, 5, 'c-low');
  const resend = await bid(as, c.id, 5, 'c-low');
  check('re-sending a refused attempt right away is re-checked, not rate limited', !r.ok && r.code === 'BELOW_MINIMUM' && resend.code === 'BELOW_MINIMUM', `${r.code} / ${resend.code}`);

  console.log('\n== 8. Every refusal has a specific code and the minimum (RF10)');
  const outsider = await signup('Fora da Sala', 'fora@test.com');
  const os = await connect(outsider.token);
  r = await bid(os, a.id, 2000, 'o1');
  check('not in the room → NOT_IN_ROOM with the minimum', !r.ok && r.code === 'NOT_IN_ROOM' && r.currentMinBid === 1100, JSON.stringify(r));
  r = await os.emitWithAck('bid:place', { auctionId: a.id, amount: -5 });
  check('invalid amount → INVALID_BID with the minimum', !r.ok && r.code === 'INVALID_BID' && r.currentMinBid === 1100, JSON.stringify(r));
  const guest = await connect();
  r = await bid(guest, a.id, 2000, 'g1');
  check('no session → SESSION_INVALID with the minimum', !r.ok && r.code === 'SESSION_INVALID' && r.currentMinBid === 1100, JSON.stringify(r));
  r = await bid(guest, 99999, 2000, 'g2');
  check('unknown auction → no minimum to tell', !r.ok && r.currentMinBid === undefined, JSON.stringify(r));

  console.log('\n== 7. A bid that can\'t be saved is not accepted');
  await sleep(550);
  const roomBids = [];
  as.on('room:bid', (p) => roomBids.push(p));
  const before = (await api('GET', `/auctions/${c.id}`)).body;
  chmodSync(DATA, 0o555); // the save fails: the temp file can't be created
  r = await bid(bs, c.id, 1000, 'disk-full');
  chmodSync(DATA, 0o755);
  check('the bidder is told it failed, with the minimum', !r.ok && r.error === 'Algo deu errado. Tente novamente.' && r.currentMinBid === 1000, JSON.stringify(r));
  await sleep(150);
  const after = (await api('GET', `/auctions/${c.id}`)).body;
  check('nothing changed in memory', after.bidCount === before.bidCount && after.currentPrice === before.currentPrice, `bidCount ${after.bidCount}`);
  check('the room was not told', roomBids.length === 0);
  await sleep(550);
  r = await bid(bs, c.id, 1000, 'disk-full');
  check('retrying with the same key once the disk is back creates the bid', r.ok && r.bid.amount === 1000, r.error);
  r = await bid(bs, c.id, 1000, 'disk-full');
  check('…exactly once', r.ok && (await api('GET', `/auctions/${c.id}`)).body.bidCount === 1);

  console.log('\n   cancel');
  const d = await create(seller.token, { title: 'Leilão D' });
  chmodSync(DATA, 0o555);
  const cancel = await api('POST', `/auctions/${d.id}/cancel`, null, seller.token);
  chmodSync(DATA, 0o755);
  check('a cancellation that can\'t be saved fails', cancel.status === 500);
  check('…and the auction is not cancelled in memory', (await api('GET', `/auctions/${d.id}`)).body.cancelledAt === null);
  const e = await create(seller.token, { title: 'Leilão E' });
  await bs.emitWithAck('room:join', e.id, 'participant');
  await sleep(550);
  chmodSync(DATA, 0o555);
  const ghost = await bid(bs, e.id, 1000, 'ghost');
  check('(setup) the ghost bid reached the failing save', ghost.error === 'Algo deu errado. Tente novamente.', ghost.error);
  chmodSync(DATA, 0o755);
  // Every other write is undone the same way, e.g. a signup whose save failed
  chmodSync(DATA, 0o555);
  const failedSignup = await api('POST', '/auth/signup', { name: 'Gil Fantasma', email: 'gil@test.com', password: 'Segura#2026' });
  chmodSync(DATA, 0o755);
  check('(setup) the signup reached the failing save', failedSignup.status === 500, failedSignup.status);

  // Another change saves the store: a ghost bid (or account) would be written now
  await create(seller.token, { title: 'Leilão F' });
  const retried = await api('POST', '/auth/signup', { name: 'Gil Fantasma', email: 'gil@test.com', password: 'Segura#2026' });
  check('the failed signup left no account behind: the email is still free', retried.status === 201, retried.body?.message);

  for (const s of [as, bs, os, guest]) s.close();
  saveState({ c: c.id, d: d.id, e: e.id });
} else {
  const { c, d, e } = loadState();
  console.log('\n== 7. After a restart');
  const get = async (id) => (await api('GET', `/auctions/${id}`)).body;
  check('no ghost bid was saved by a later change', (await get(e)).bidCount === 0);
  check('the failed cancellation was not saved', (await get(d)).cancelledAt === null);
  check('the retried bid is there once', (await get(c)).bidCount === 1);
  const gil = await api('POST', '/auth/login', { email: 'gil@test.com', password: 'Segura#2026' });
  check('the account created after the disk came back was saved', gil.status === 200);
}

finish();
