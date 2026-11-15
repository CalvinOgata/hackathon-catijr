// Data saved by older versions linked the sample photos to picsum.photos, which stopped answering
// (error 522). The "break" phase puts such links back while the server is stopped; on start the
// server must replace them with local copies (and drop outside links it has no copy for).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { URL, DATA, phase, check, finish, api } from './lib.mjs';

const FILE = join(DATA, 'store.json');

if (phase === 'break') {
  const data = JSON.parse(readFileSync(FILE, 'utf8'));
  data.items[0].photos = [1, 2, 3].map((k) => `https://picsum.photos/seed/auction-1-${k}/960/640`);
  data.items[1].title = 'Item que não é de exemplo';
  data.items[1].photos = ['https://example.com/a.jpg', data.items[1].photos[0]];
  writeFileSync(FILE, JSON.stringify(data));
} else {
  const saved = readFileSync(FILE, 'utf8');
  check('no outside photo links are left on disk', !saved.includes('https://'));
  const first = (await api('GET', '/auctions/1')).body;
  check('the sample item has 3 local photos again', first.photos.length === 3 && first.photos.every((url) => url.startsWith('/api/photos/')), first.photos.join(' '));
  const statuses = await Promise.all(first.photos.map((url) => fetch(URL + url).then((r) => r.status)));
  check('…and they are served', statuses.every((status) => status === 200), statuses.join(' '));
  const second = (await api('GET', '/auctions/2')).body;
  check('an outside link with no local copy is dropped, local photos stay', second.photos.length === 1 && second.photos[0].startsWith('/api/photos/'), second.photos.join(' '));
}

finish();
