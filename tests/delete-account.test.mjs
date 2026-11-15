// Deleting an account: what blocks it, the password and confirmation, and the anonymized history
// that stays (also after a restart).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { URL, DATA, phase, check, finish, sleep, json, api, connect, PNG, saveState, loadState } from './lib.mjs';

const signup = async (name, email) => (await api('POST', '/auth/signup', { name, email, password: 'Segura#2026' })).body.token;
const del = (token, password = 'Segura#2026', confirmation = 'DELETAR') => api('POST', '/account/delete', { password, confirmation }, token);
function create(token, fields = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ title: 'Luminária Art Déco', description: 'Bronze e vidro, anos 1930.', category: 'Design', startingPrice: '1000', minIncrement: '100', durationMinutes: '60', ...fields })) form.append(k, v);
  for (let i = 0; i < 3; i++) form.append('photos', new Blob([PNG]), 'p.png');
  return fetch(`${URL}/api/auctions`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }).then(json).then((r) => r.body);
}

if (phase === 'main') {
  const seller = await signup('Sofia Vendedora', 'sofia@test.com');
  const buyer = await signup('Bruno Comprador', 'bruno@test.com');
  const free = await signup('Lia Sem Pendências', 'lia@test.com');

  const auction = await create(seller);
  const scheduled = await create(seller, { title: 'Agendado', startsAt: new Date(Date.now() + 3600_000).toISOString() });

  console.log('\n== Blockers');
  let r = await api('GET', '/account/deletion-check', null, seller);
  check('seller: active auctions listed (live and scheduled)', r.body.auctions.length === 2 && r.body.bids.length === 0, JSON.stringify(r.body.auctions.map((a) => a.status)));
  r = await del(seller);
  check('seller with active auctions can\'t delete → 409', r.status === 409, r.body.message);

  const buyerSocket = await connect(buyer);
  await buyerSocket.emitWithAck('room:join', auction.id, 'participant');
  const bid = await buyerSocket.emitWithAck('bid:place', { auctionId: auction.id, amount: 1000 });
  check('buyer bids', bid.ok);
  r = await api('GET', '/account/deletion-check', null, buyer);
  check('buyer: live auction with their bid listed', r.body.bids.length === 1 && r.body.bids[0].id === auction.id);
  r = await del(buyer);
  check('buyer with a bid in a live auction can\'t delete → 409', r.status === 409, r.body.message);

  r = await api('POST', `/auctions/${scheduled.id}/cancel`, null, seller);
  r = await api('GET', '/account/deletion-check', null, seller);
  check('cancelling the scheduled one removes it from the blockers', r.body.auctions.length === 1);

  console.log('\n== Confirmation and password');
  check('guest → 401', (await del(null)).status === 401);
  r = await del(free, 'Segura#2026', 'deletar');
  check('"deletar" (lowercase) is not accepted → 400', r.status === 400, r.body.message);
  r = await del(free, 'Errada#1');
  check('wrong password → 403 with attempts left', r.status === 403, r.body.message);
  r = await del(free, 'Errada#2');
  r = await del(free, 'Errada#3');
  check('3rd wrong password → locked (429)', r.status === 429, r.body.message);
  r = await del(free);
  check('correct password refused while locked', r.status === 429);
  await sleep(6500);

  console.log('\n== Deleting');
  const otherDevice = (await api('POST', '/auth/login', { email: 'lia@test.com', password: 'Segura#2026' })).body.token;
  const otherSocket = await connect(otherDevice);
  let told = false;
  otherSocket.on('session:expired', () => (told = true));
  r = await del(free);
  check('deleted → 204', r.status === 204);
  await sleep(150);
  check('this session is gone', (await api('GET', '/auth/me', null, free)).status === 401);
  check('sessions on other devices are gone too', (await api('GET', '/auth/me', null, otherDevice)).status === 401);
  check('open connections were told', told);
  r = await api('POST', '/auth/login', { email: 'lia@test.com', password: 'Segura#2026' });
  check('can\'t log in anymore', r.status === 401);
  r = await api('POST', '/auth/signup', { name: 'Lia de Novo', email: 'lia@test.com', password: 'Segura#2026' });
  check('the email is released: a brand-new account can use it', r.status === 201 && r.body.user.name === 'Lia de Novo', `new id ${r.body.user?.id}`);

  buyerSocket.close();
  otherSocket.close();
  saveState({ seller, buyer, auctionId: auction.id, photos: auction.photos });
} else if (phase === 'age') {
  const { auctionId } = loadState();
  const file = `${DATA}/store.json`;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const a = data.auctions.find((x) => x.id === auctionId);
  a.endsAt = Date.now() - 1000;
  writeFileSync(file, JSON.stringify(data));
  console.log(`(auction ${auctionId} has now ended, sold to the buyer)`);
} else if (phase === 'after-end') {
  const { seller, buyer, auctionId, photos } = loadState();
  console.log('\n== After the auction ended (sold)');
  let r = await api('GET', '/account/deletion-check', null, buyer);
  check('buyer has nothing open anymore', r.body.bids.length === 0 && r.body.auctions.length === 0);
  check('buyer (the winner) deletes their account', (await del(buyer)).status === 204);
  check('seller deletes their account', (await del(seller)).status === 204);

  r = await api('GET', `/auctions/${auctionId}`);
  check('the auction is still there, sold, with its data', r.status === 200 && r.body.bidCount === 1 && r.body.currentPrice === 1000 && r.body.title === 'Luminária Art Déco');
  check('seller shown as "Conta excluída"', r.body.sellerName === 'Conta excluída', r.body.sellerName);
  const viewer = await signup('Vítor Visitante', 'vitor@test.com');
  const s = await connect(viewer);
  const join = await s.emitWithAck('room:join', auctionId, 'participant');
  check('its bid is kept, attributed to "Conta excluída"', join.ok && join.auction.recentBids.length === 1 && join.auction.recentBids[0].bidderName === 'Conta excluída', join.auction.recentBids[0]?.bidderName);
  s.close();
  const files = readdirSync(`${DATA}/photos`);
  check('its photos are kept', photos.every((url) => files.includes(url.split('/').pop())));
  const saved = readFileSync(`${DATA}/store.json`, 'utf8');
  check('no trace of the deleted emails or names on disk', !saved.includes('sofia@test.com') && !saved.includes('bruno@test.com') && !saved.includes('Sofia Vendedora') && !saved.includes('Bruno Comprador'));
} else {
  console.log('\n== After restart');
  let r = await api('POST', '/auth/login', { email: 'sofia@test.com', password: 'Segura#2026' });
  check('deleted accounts still can\'t log in', r.status === 401);
  r = await api('POST', '/auth/signup', { name: 'Sofia Nova', email: 'sofia@test.com', password: 'Segura#2026' });
  check('their emails are still free to reuse', r.status === 201);
  r = await api('POST', '/auth/signup', { name: 'Outra', email: 'lia@test.com', password: 'Segura#2026' });
  check('but the re-created "lia" account still blocks a duplicate (RF01)', r.status === 409);
}

finish();
