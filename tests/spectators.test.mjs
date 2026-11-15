// RF25: spectators and participants, upgrading in place, and the headcount (people, not tabs).
import { URL, check, finish, sleep, json, api, PNG, io } from './lib.mjs';

const signup = async (name, email) => (await api('POST', '/auth/signup', { name, email, password: 'Segura#2026' })).body.token;
const login = async (email) => (await api('POST', '/auth/login', { email, password: 'Segura#2026' })).body.token;
const connect = (token) => new Promise((res) => { const s = io(URL, { auth: token ? { token } : {}, forceNew: true }); s.presence = []; s.bids = []; s.on('room:presence', (p) => s.presence.push(p)); s.on('room:bid', (p) => s.bids.push(p)); s.on('connect', () => res(s)); });
const lastPresence = (s, id) => [...s.presence].reverse().find((p) => p.auctionId === id);
const counts = (s, id) => { const p = lastPresence(s, id); return p ? `${p.participants}P/${p.spectators}E` : 'none'; };
function create(token, fields = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ title: 'Leilão de teste', description: 'Descrição do item de teste.', category: 'Outros', startingPrice: '1000', durationMinutes: '60', ...fields })) form.append(k, v);
  for (let i = 0; i < 3; i++) form.append('photos', new Blob([PNG]), 'p.png');
  return fetch(`${URL}/api/auctions`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }).then(json).then((r) => r.body);
}

const seller = await signup('Sofia Vendedora', 'sofia@test.com');
const ana = await signup('Ana Souza', 'ana@test.com');
const beto = await signup('Beto Lima', 'beto@test.com');
const a = await create(seller);

console.log('== Joining');
const sellerSock = await connect(seller);
let r = await sellerSock.emitWithAck('room:join', a.id, 'participant');
check('the seller asking to participate is made a spectator', r.ok && r.mode === 'spectator', r.mode);
r = await sellerSock.emitWithAck('room:join', a.id, 'participant');
check('the seller asking again still only watches their own auction', r.ok && r.mode === 'spectator', r.mode);

const anaSock = await connect(ana);
r = await anaSock.emitWithAck('room:join', a.id, 'spectator');
check('join answers once, with mode and viewerTag', r.ok && r.mode === 'spectator' && typeof r.viewerTag === 'string' && r.auction.recentBids);
await sleep(150);
check('everyone sees 0 participants, 2 spectators', counts(sellerSock, a.id) === '0P/2E' && counts(anaSock, a.id) === '0P/2E', counts(sellerSock, a.id));

console.log('\n== Spectators can\'t bid; upgrading in place');
r = await anaSock.emitWithAck('bid:place', { auctionId: a.id, amount: 1000, idempotencyKey: 's1' });
check('a spectator\'s bid is refused with a clear reason', !r.ok && r.code === 'NOT_IN_ROOM' && r.error.includes('espectador'), r.error);
r = await anaSock.emitWithAck('room:join', a.id, 'participant');
check('joining again as participant upgrades in place', r.ok && r.mode === 'participant' && typeof r.viewerTag === 'string');
await sleep(150);
check('headcount: 1 participant, 1 spectator', counts(sellerSock, a.id) === '1P/1E', counts(sellerSock, a.id));
await sleep(500);
r = await anaSock.emitWithAck('bid:place', { auctionId: a.id, amount: 1000, idempotencyKey: 'p1' });
check('the participant bids', r.ok, r.error);
await sleep(150);
check('the bid reaches participants and spectators exactly once', anaSock.bids.length === 1 && sellerSock.bids.length === 1, `${anaSock.bids.length} / ${sellerSock.bids.length}`);
check('the room bid has no extra fields', Object.keys(sellerSock.bids[0]).sort().join() === 'auction,bid', Object.keys(sellerSock.bids[0]).join());

const outsider = await connect(beto);
await sleep(100);
check('someone outside the room gets no bids or headcount', outsider.bids.length === 0 && outsider.presence.length === 0);

console.log('\n== People, not connections');
const anaTab2 = await connect(await login('ana@test.com'));
await anaTab2.emitWithAck('room:join', a.id, 'spectator');
await sleep(150);
check('Ana watching in a 2nd tab while participating in the 1st still counts once, as participant', counts(sellerSock, a.id) === '1P/1E', counts(sellerSock, a.id));
r = await anaTab2.emitWithAck('room:join', a.id, 'participant');
r = await anaTab2.emitWithAck('room:join', a.id, 'spectator');
await sleep(150);
check('rejoining with another mode moves the connection (never in both rooms)', counts(sellerSock, a.id) === '1P/1E', counts(sellerSock, a.id));

console.log('\n== Leaving');
const betoSock = await connect(beto);
await betoSock.emitWithAck('room:join', a.id, 'spectator');
await sleep(150);
check('Beto joins: 1P/2E', counts(sellerSock, a.id) === '1P/2E', counts(sellerSock, a.id));
betoSock.close();
await sleep(300);
check('closing a tab updates the headcount', counts(sellerSock, a.id) === '1P/1E', counts(sellerSock, a.id));
anaSock.emit('room:leave', a.id);
await sleep(150);
check('leaving updates it (Ana still watches in tab 2)', counts(sellerSock, a.id) === '0P/2E', counts(sellerSock, a.id));
await api('POST', '/auth/logout', null, await login('ana@test.com')); // another session: no effect
const anaToken2 = anaTab2.io.opts.auth.token;
await api('POST', '/auth/logout', null, anaToken2);
await sleep(200);
check('logging out removes that session\'s connections from the count', counts(sellerSock, a.id) === '0P/1E', counts(sellerSock, a.id));

for (const s of [sellerSock, anaSock, anaTab2, outsider]) s.close();
finish();
