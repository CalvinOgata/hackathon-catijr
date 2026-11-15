// Bids (RF09–RF14): masked bidder names, no bidder data in public listings, the same bid sent
// again (RF12, also after a restart), the minimum from the increment table (RF14) and late bids.
import { readFileSync, writeFileSync } from 'node:fs';
import { URL, DATA, phase, check, finish, sleep, json, api, connect, PNG, saveState, loadState } from './lib.mjs';

const signup = async (name, email) => (await api('POST', '/auth/signup', { name, email, password: 'Segura#2026' })).body;
const login = async (email) => (await api('POST', '/auth/login', { email, password: 'Segura#2026' })).body.token;
function create(token, fields = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ title: 'Item de teste', description: 'Descrição do item de teste.', category: 'Outros', startingPrice: '1000', durationMinutes: '60', ...fields })) form.append(k, v);
  for (let i = 0; i < 3; i++) form.append('photos', new Blob([PNG]), 'p.png');
  return fetch(`${URL}/api/auctions`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }).then(json);
}
const BIDDER_FIELDS = ['highestBidderId', 'highestBidderName', 'bidderId'];
const hasBidderData = (obj) => BIDDER_FIELDS.some((f) => f in obj);

if (phase === 'main') {
  const carla = await signup('Carla Mendes Vieira', 'carla@test.com');
  const bob = await signup('Roberto Alves', 'bob@test.com');
  const dave = await signup('Davi Rocha', 'dave@test.com');
  const seller = await signup('Outro Vendedor', 'outro@test.com');

  console.log('== 3. Sellers no longer choose an increment (RF14)');
  let created = await create(seller.token, { title: 'Leilão A' });
  check('listing without an increment is accepted', created.status === 201, created.body.message);
  const a = created.body;
  check('server sends minBid and minIncrement from the table', a.minBid === 1000 && a.minIncrement === 100, `${a.minBid} / ${a.minIncrement}`);
  const b = (await create(seller.token, { title: 'Leilão B', startingPrice: '49900' })).body;
  await create(carla.token, { title: 'Item da Carla' }); // Carla's full name is public as a seller

  const guest = await connect();
  const publicUpdates = [];
  guest.on('auction:updated', (x) => publicUpdates.push(x));

  console.log('\n== 1. Bidder identity');
  const cs = await connect(carla.token);
  const bs = await connect(bob.token);
  const ds = await connect(dave.token);
  const carlaA = await cs.emitWithAck('room:join', a.id, 'participant');
  const carlaB = await cs.emitWithAck('room:join', b.id, 'participant');
  const bobA = await bs.emitWithAck('room:join', a.id, 'participant');
  await bs.emitWithAck('room:join', b.id, 'participant');
  await ds.emitWithAck('room:join', b.id, 'participant');
  check('join gives a viewerTag', typeof carlaA.viewerTag === 'string' && carlaA.viewerTag.length >= 12, carlaA.viewerTag);
  check('the same user has a different tag in each auction', carlaA.viewerTag !== carlaB.viewerTag);
  check('different users have different tags', carlaA.viewerTag !== bobA.viewerTag);

  const roomBids = [];
  bs.on('room:bid', (p) => roomBids.push(p));
  let r = await cs.emitWithAck('bid:place', { auctionId: a.id, amount: 1000, idempotencyKey: 'k1' });
  check('Carla bids', r.ok);
  check('her bid carries her tag and masked name, no user id', r.bid.bidderTag === carlaA.viewerTag && r.bid.bidderName === 'Carla V.' && !hasBidderData(r.bid));
  await sleep(150);
  check('the room gets the bid with the same tag', roomBids.length === 1 && roomBids[0].bid.bidderTag === carlaA.viewerTag && !hasBidderData(roomBids[0].bid));
  const pub = (await api('GET', `/auctions/${a.id}`)).body;
  const list = (await api('GET', '/auctions?limit=50')).body.auctions;
  check('public auction has no bidder data', !hasBidderData(pub) && list.every((x) => !hasBidderData(x)));
  check('public update has no bidder data', publicUpdates.length > 0 && publicUpdates.every((x) => !hasBidderData(x)));
  const join = await bs.emitWithAck('room:join', a.id, 'participant');
  check('recent bids on join have no user id', join.auction.recentBids.every((x) => !hasBidderData(x) && x.bidderTag));
  const serialized = JSON.stringify([pub, list, publicUpdates, roomBids, join]);
  check('Carla\'s user id appears nowhere next to bid data', !serialized.includes(`"highestBidderId":${carla.user.id}`) && !serialized.includes(`"bidderId"`));

  console.log('\n== 14. Minimum follows the table');
  check('after the first bid the minimum is price + increment', r.auction.minBid === 1100, r.auction.minBid);
  r = await bs.emitWithAck('bid:place', { auctionId: a.id, amount: 1050, idempotencyKey: 'b-low' });
  check('below the server minimum is refused with the minimum', !r.ok && r.currentMinBid === 1100, r.error);
  await sleep(600);
  r = await bs.emitWithAck('bid:place', { auctionId: a.id, amount: 1100, idempotencyKey: 'b1' });
  check('Bob outbids Carla', r.ok);

  console.log('\n== 2. Re-sending the same bid (RF12)');
  roomBids.length = 0;
  r = await cs.emitWithAck('bid:place', { auctionId: a.id, amount: 1000, idempotencyKey: 'k1' });
  const detail = (await api('GET', `/auctions/${a.id}`)).body;
  check('after being outbid, the re-sent bid returns the original one', r.ok && r.bid.amount === 1000 && r.bid.bidderTag === carlaA.viewerTag);
  check('…and creates nothing: still 2 bids, Bob leads', detail.bidCount === 2 && detail.currentPrice === 1100, `bidCount ${detail.bidCount}`);
  await sleep(150);
  check('…and the room is not told about it again', roomBids.length === 0);
  await sleep(550); // RF13
  r = await bs.emitWithAck('bid:place', { auctionId: a.id, amount: 1000, idempotencyKey: 'k1' });
  check('another user\'s bid with the same key is a different bid (refused: Bob leads)', !r.ok && r.code === 'ALREADY_LEADER', r.error);
  r = await cs.emitWithAck('bid:place', { auctionId: a.id, amount: 1200, idempotencyKey: 42 });
  check('a non-text key is refused cleanly', !r.ok && r.code === 'INVALID_BID', JSON.stringify(r));
  r = await cs.emitWithAck('bid:place', { auctionId: a.id, amount: 1200, idempotencyKey: 'x'.repeat(101) });
  check('a key over 100 characters is refused', !r.ok && r.code === 'INVALID_BID');

  console.log('\n== 6. Setup: Davi bids on B, which will end');
  r = await ds.emitWithAck('bid:place', { auctionId: b.id, amount: 49900, idempotencyKey: 'd1' });
  check('Davi bids on B', r.ok);
  check('at R$ 499,00 the increment is R$ 5,00', r.auction.minIncrement === 500 && r.auction.minBid === 50400, `${r.auction.minIncrement} / ${r.auction.minBid}`);
  const store = readFileSync(`${DATA}/store.json`, 'utf8');
  check('idempotency keys are saved with the bids', store.includes('"idempotencyKey":"k1"') && !store.includes('"minIncrement"'));

  for (const s of [guest, cs, bs, ds]) s.close();
  saveState({ a: a.id, b: b.id, carlaTag: carlaA.viewerTag });
} else if (phase === 'age') {
  const { b } = loadState();
  const file = `${DATA}/store.json`;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.auctions.find((x) => x.id === b).endsAt = Date.now() - 1000;
  writeFileSync(file, JSON.stringify(data));
  console.log(`(auction ${b} has ended, sold to Davi)`);
} else {
  const { a, b } = loadState();
  console.log('\n== 2. After a restart');
  const carla = await login('carla@test.com');
  const cs = await connect(carla);
  const join = await cs.emitWithAck('room:join', a, 'participant');
  const r = await cs.emitWithAck('bid:place', { auctionId: a, amount: 1000, idempotencyKey: 'k1' });
  const detail = (await api('GET', `/auctions/${a}`)).body;
  check('the re-sent bid still returns the original one', r.ok && r.bid.amount === 1000 && r.bid.bidderTag === join.viewerTag, r.error);
  check('…without a new bid', detail.bidCount === 2);

  console.log('\n== 6. Deleted account name');
  const dave = await login('dave@test.com');
  const del = await api('POST', '/account/delete', { password: 'Segura#2026', confirmation: 'DELETAR' }, dave);
  check('Davi deletes his account', del.status === 204, del.body?.message);
  const room = await cs.emitWithAck('room:join', b, 'participant');
  check('his bid shows "Conta excluída", not "Conta E."', room.auction.recentBids[0]?.bidderName === 'Conta excluída', room.auction.recentBids[0]?.bidderName);
  cs.close();
}

finish();
