// RF05/RF06: creating auctions with their limits and photo checks, and that auctions and photos
// survive a restart.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { URL, DATA, phase, check, finish, json, api, saveState, loadState, io } from './lib.mjs';

// Real image signatures (only the header bytes are checked) + some padding
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(200, 3)]);
const FAKE = Buffer.from('<?php echo "not an image"; ?>');

const base = { title: 'Câmera Rolleiflex 2.8F', description: 'Câmera de médio formato em ótimo estado.', category: 'Eletrônicos', startingPrice: '150000', minIncrement: '5000', durationMinutes: '3' };
function create(token, fields = {}, photos = [PNG, JPEG, WEBP], names = ['a.png', 'b.jpg', 'c.webp']) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...fields })) if (v !== undefined) form.append(k, v);
  photos.forEach((p, i) => form.append('photos', new Blob([p], { type: names[i]?.endsWith('.jpg') ? 'image/jpeg' : 'image/png' }), names[i] ?? `p${i}.png`));
  return fetch(`${URL}/api/auctions`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: form }).then(json);
}
const SEEDED = 48; // the sample auctions' photos, stored like uploads
const photoFiles = () => (existsSync(`${DATA}/photos`) ? readdirSync(`${DATA}/photos`) : []);

if (phase === 'create') {
  console.log('\n== Rules endpoint (RF06)');
  let r = await api('GET', '/auctions/rules');
  check('rules are public and reflect .env overrides', r.status === 200 && r.body.photos.min === 3 && r.body.durationMinutes.min === 3 && r.body.leadMinutes.min === 1, JSON.stringify({ photos: r.body.photos, lead: r.body.leadMinutes, duration: r.body.durationMinutes }));

  const signup = await api('POST', '/auth/signup', { name: 'Vera Comitente', email: 'vera@test.com', password: 'Segura#2026' });
  const token = signup.body.token;
  const buyer = (await api('POST', '/auth/signup', { name: 'Rui Comprador', email: 'rui@test.com', password: 'Segura#2026' })).body.token;

  console.log('\n== Validation (nothing is written for invalid requests)');
  r = await create(null);
  check('guest cannot create', r.status === 401);
  const now = Date.now();
  for (const [label, fields, photos, names] of [
    ['only 2 photos', {}, [PNG, JPEG]],
    ['a text file disguised as .jpg', {}, [PNG, JPEG, FAKE], ['a.png', 'b.jpg', 'evil.jpg']],
    ['name too short', { title: 'TV' }],
    ['description too short', { description: 'Boa' }],
    ['unknown category', { category: 'Armas' }],
    ['price in fractions of a cent', { startingPrice: '100.5' }],
    ['price below R$ 1,00', { startingPrice: '50' }],
    ['duration 2 min (min is 3)', { durationMinutes: '2' }],
    ['start in the past', { startsAt: new Date(now - 60_000).toISOString() }],
    ['start in 30s (min lead is 1 min)', { startsAt: new Date(now + 30_000).toISOString() }],
    ['start in 31 days (max lead is 30)', { startsAt: new Date(now + 31 * 86_400_000).toISOString() }],
    ['garbage start time', { startsAt: 'amanhã cedo' }],
  ]) {
    r = await create(token, fields, photos, names);
    check(`rejects ${label}`, r.status === 400, r.body.message);
  }
  r = await create(token, {}, Array(9).fill(PNG), Array(9).fill('x.png'));
  check('rejects 9 photos (max 8)', r.status === 413, r.body.message);
  r = await create(token, {}, [PNG, JPEG, Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)])]);
  check('rejects a 6 MB photo (max 5)', r.status === 413, r.body.message);
  check('no photo files were written by invalid requests', photoFiles().length === SEEDED, `${photoFiles().length} files`);

  console.log('\n== Creating');
  const guest = await new Promise((res) => { const s = io(URL, { forceNew: true }); s.on('connect', () => res(s)); });
  const created = [];
  guest.on('auction:created', (a) => created.push(a));
  r = await create(token);
  const asap = r.body;
  const lead = Date.parse(asap.startsAt) - Date.now();
  check('created "as soon as possible" → starts ~1 min from now (server clock)', r.status === 201 && lead > 50_000 && lead <= 60_000, `${Math.round(lead / 1000)}s`);
  check('ends start + duration', Date.parse(asap.endsAt) - Date.parse(asap.startsAt) === 3 * 60_000);
  check('item fields, seller and 3 photos', asap.title === 'Câmera Rolleiflex 2.8F' && asap.sellerName === 'Vera Comitente' && asap.photos.length === 3 && asap.itemId > 0, asap.photos.join(' '));
  const startsAt = new Date(Date.now() + 2 * 3600_000).toISOString();
  r = await create(token, { title: 'Relógio de bolso Omega 1920', startsAt, durationMinutes: '1440' });
  check('created with a scheduled start in 2h, lasting 1 day', r.status === 201 && r.body.startsAt === startsAt, r.body.startsAt);
  await new Promise((res) => setTimeout(res, 150));
  check('everyone is told about new listings', created.length === 2);
  guest.close();

  console.log('\n== Photos on disk, served back');
  check('6 photo files on disk (plus the samples)', photoFiles().length === SEEDED + 6, `${photoFiles().length} files`);
  const photo = await fetch(`${URL}${asap.photos[2]}`);
  const bytes = Buffer.from(await photo.arrayBuffer());
  check('photo served with its real type and identical bytes', photo.status === 200 && photo.headers.get('content-type') === 'image/webp' && bytes.equals(WEBP), photo.headers.get('content-type'));
  for (const bad of ['..%2F..%2Fpackage.json', 'store.json', '..%2Fstore.json', 'abc.png']) {
    check(`cannot fetch arbitrary files: ${decodeURIComponent(bad)}`, (await fetch(`${URL}/api/photos/${bad}`)).status === 404);
  }

  console.log('\n== Bids respect the start time');
  const s = await new Promise((res) => { const x = io(URL, { auth: { token: buyer }, forceNew: true }); x.on('connect', () => res(x)); });
  await s.emitWithAck('room:join', asap.id, 'participant');
  const bid = await s.emitWithAck('bid:place', { auctionId: asap.id, amount: 150000 });
  check('bid before the start is rejected', !bid.ok, bid.error);
  s.close();

  console.log('\n== Saved to disk');
  const saved = JSON.parse(readFileSync(`${DATA}/store.json`, 'utf8'));
  check('store.json has users, items, auctions, sessions', saved.users.length === 6 && saved.items.length === 18 && saved.auctions.length === 18 && saved.sessions.length >= 2, `users ${saved.users.length}, items ${saved.items.length}, auctions ${saved.auctions.length}, sessions ${saved.sessions.length}`);
  check('no plaintext password or token on disk', !JSON.stringify(saved).includes('Segura#2026') && !JSON.stringify(saved).includes(token));
  saveState({ token, auctionId: asap.id, photos: asap.photos });
} else {
  const { token, auctionId, photos } = loadState();
  console.log('\n== After restart');
  let r = await api('GET', '/auth/me', null, token);
  check('still logged in with the same session', r.status === 200 && r.body.name === 'Vera Comitente');
  r = await api('POST', '/auth/login', { email: 'rui@test.com', password: 'Segura#2026' });
  check('accounts survived (login works)', r.status === 200);
  r = await api('GET', `/auctions/${auctionId}`);
  check('auction survived with its photos', r.status === 200 && JSON.stringify(r.body.photos) === JSON.stringify(photos));
  check('photo still served', (await fetch(`${URL}${photos[0]}`)).status === 200);
  const savedAgain = JSON.parse(readFileSync(`${DATA}/store.json`, 'utf8'));
  check('sample data not seeded twice', savedAgain.auctions.length === 18, `${savedAgain.auctions.length} auctions`);
  const form = new FormData();
  for (const [k, v] of Object.entries(base)) form.append(k, v);
  for (const p of [PNG, JPEG, WEBP]) form.append('photos', new Blob([p]), 'x');
  r = await json(await fetch(`${URL}/api/auctions`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }));
  check('new ids continue after the saved ones', r.status === 201 && r.body.id === 19 && r.body.itemId === 19, `auction ${r.body.id}, item ${r.body.itemId}`);
}

finish();
