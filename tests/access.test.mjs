// RF01–RF04: signup, login, sessions that renew with use and expire (idle and absolute), rooms
// that require login, sellers who can't bid on their own auctions, and what guests can see.
import { URL, check, finish, sleep, api, connect, collect } from './lib.mjs';

const login = async (email, password = 'Segura#2026') => (await api('POST', '/auth/login', { email, password })).body.token;
const listing = { title: 'Test guitar', description: 'Nice guitar, works', category: 'Música', startingPrice: 10000, minIncrement: 1000, durationMinutes: 60 };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
const createListing = async (patch, token, photos = [PNG, PNG, PNG]) => {
  const form = new FormData();
  for (const [k, v] of Object.entries({ ...listing, ...patch })) form.append(k, String(v));
  for (const p of photos) form.append('photos', new Blob([p]), 'p.png');
  const res = await fetch(`${URL}/api/auctions`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: form });
  return { status: res.status, body: await res.json() };
};

console.log('\n== RF01: signup, login, one email = one account');
let r = await api('POST', '/auth/signup', { name: 'Carla', email: 'carla@test.com', password: 'Segura#2026' });
check('signup succeeds', r.status === 201 && r.body.user.email === 'carla@test.com');
r = await api('POST', '/auth/signup', { name: 'Other', email: 'CARLA@Test.com', password: 'Segura#2026' });
check('same email, different case → 409', r.status === 409, r.body.message);
const race = await Promise.all([0, 1, 2].map(() => api('POST', '/auth/signup', { name: 'Dup', email: 'race@test.com', password: 'Segura#2026' })));
const codes = race.map((x) => x.status).sort();
check('3 simultaneous signups, same email → one 201, two 409, no 500', JSON.stringify(codes) === '[201,409,409]', codes.join(','));
r = await api('POST', '/auth/signup', { name: '   a   ', email: 'short@test.com', password: 'Segura#2026' });
check('display name of whitespace + 1 char rejected', r.status === 400, r.body.message);
r = await api('POST', '/auth/login', { email: 'carla@test.com', password: 'Errada#2026' });
check('wrong password → 401', r.status === 401);
r = await api('POST', '/auth/login', { email: 'Carla@test.com', password: 'Segura#2026' });
check('login works (email case-insensitive)', r.status === 200 && !!r.body.token);
await api('POST', '/auth/signup', { name: 'Davi', email: 'davi@test.com', password: 'Segura#2026' });

console.log('\n== RF02: protected actions need a valid session; sessions expire');
r = await api('GET', '/auth/me');
check('/me without session → 401 SESSION_INVALID', r.status === 401 && r.body.code === 'SESSION_INVALID');
r = await api('GET', '/auth/me', null, 'made-up-token');
check('/me with forged token → 401', r.status === 401);
let token = await login('carla@test.com');
const sock = await connect(token);
const expiredEvents = collect(sock, 'session:expired');
check('room join with valid session', (await sock.emitWithAck('room:join', 2, 'participant')).ok);
await api('POST', '/auth/logout', null, token);
r = await api('GET', '/auth/me', null, token);
check('token is dead after logout', r.status === 401);
await sleep(100);
check('open socket told its session ended on logout', expiredEvents.length === 1);
let bid = await sock.emitWithAck('bid:place', { auctionId: 2, amount: 2_000_000 });
check('bid on still-open socket after logout rejected', !bid.ok && bid.code === 'SESSION_INVALID', bid.error);
sock.close();

token = await login('carla@test.com');
const idleSock = await connect(token);
check('fresh session can join room', (await idleSock.emitWithAck('room:join', 2, 'participant')).ok);
await sleep(7000);
bid = await idleSock.emitWithAck('bid:place', { auctionId: 2, amount: 1_200_000 });
check('after 7s idle (> 6s timeout) bid rejected on open socket', !bid.ok && bid.code === 'SESSION_INVALID', bid.error);
r = await api('GET', '/auth/me', null, token);
check('after idle timeout HTTP also rejected', r.status === 401);
idleSock.close();

token = await login('carla@test.com');
let alive = true;
for (let t = 0; t < 4; t++) { await sleep(2500); alive &&= (await api('GET', '/auth/me', null, token)).status === 200; }
check('used every 2.5s for 10s (> 6s idle) → still valid (renews with use)', alive);
await sleep(3500);
r = await api('GET', '/auth/me', null, token);
check('still used, but past ~13s absolute lifetime → expired', r.status === 401);

console.log('\n== RF03: any logged-in user lists items; no admin');
r = await createListing({});
check('guest cannot list', r.status === 401);
const carla = await login('carla@test.com');
const guest = await connect();
const created = collect(guest, 'auction:created');
r = await createListing({}, carla);
check('logged-in user lists an item', r.status === 201 && r.body.sellerName === 'Carla', `id ${r.body.id}`);
const carlaAuction = r.body;
await sleep(100);
check('new listing pushed to everyone (even guests)', created.length === 1 && created[0].id === carlaAuction.id);
for (const [label, patch, photos] of [['bad category', { category: 'Armas' }], ['a non-image photo', {}, [PNG, PNG, Buffer.from('hello')]], ['1-minute duration', { durationMinutes: 1 }], ['price in fractions of a cent', { startingPrice: 100.5 }], ['blank title', { title: '    ' }]]) {
  r = await createListing(patch, carla, photos);
  check(`rejects ${label}`, r.status === 400, r.body.message);
}

console.log('\n== RF04: public listings, login to enter room, seller never bids on own auction');
r = await api('GET', '/auctions');
check('guest sees listings', r.status === 200 && r.body.auctions.length >= 12);
r = await api('GET', `/auctions/${carlaAuction.id}`);
check('public listing has no bid history', r.status === 200 && !('recentBids' in r.body));
let join = await guest.emitWithAck('room:join', carlaAuction.id, 'participant');
check('guest cannot enter room', !join.ok && join.code === 'SESSION_INVALID');
const guestUpdates = collect(guest, 'auction:updated');
const guestRoomBids = collect(guest, 'room:bid');

const carlaSock = await connect(carla);
join = await carlaSock.emitWithAck('room:join', carlaAuction.id, 'participant');
check('seller can enter own room', join.ok && Array.isArray(join.auction.recentBids));
bid = await carlaSock.emitWithAck('bid:place', { auctionId: carlaAuction.id, amount: 50_000 });
check('seller cannot bid on own auction', !bid.ok, bid.error);

const davi = await login('davi@test.com');
const daviSock = await connect(davi);
bid = await daviSock.emitWithAck('bid:place', { auctionId: carlaAuction.id, amount: 10_000 });
check('bid without entering the room rejected', !bid.ok, bid.error);
await daviSock.emitWithAck('room:join', carlaAuction.id, 'participant');
const carlaRoomBids = collect(carlaSock, 'room:bid');
bid = await daviSock.emitWithAck('bid:place', { auctionId: carlaAuction.id, amount: 10_000 });
check('another user bids in the room', bid.ok, bid.error);
await sleep(150);
check('room members get the bid with the masked bidder name', carlaRoomBids.length === 1 && carlaRoomBids[0].bid.bidderName === 'D**i', carlaRoomBids[0]?.bid.bidderName);
check('guests get the public price update…', guestUpdates.at(-1)?.currentPrice === 10_000, JSON.stringify(guestUpdates.map((u) => [u.id, u.currentPrice, u.bidCount])));
check('…but not the bid or bidder', guestRoomBids.length === 0 && !JSON.stringify(guestUpdates).includes('Davi'));

for (const s of [guest, carlaSock, daviSock]) s.close();
finish();
