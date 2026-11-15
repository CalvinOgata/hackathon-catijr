// An idle connection whose session expires is removed from its room by the sweep (once a
// minute), and the room's headcount drops. Takes about a minute.
import { api, connect } from './lib.mjs';

const signup = async (name, email) => (await api('POST', '/auth/signup', { name, email, password: 'Segura#2026' })).body.token;
const idle = await signup('Ivo Ocioso', 'ivo@test.com');
const active = await signup('Ana Ativa', 'ana@test.com');
const a = await connect(idle);
const b = await connect(active);
await a.emitWithAck('room:join', 1, 'spectator');
await b.emitWithAck('room:join', 1, 'spectator');
const presence = [];
b.on('room:presence', (p) => presence.push(p));
const keepAlive = setInterval(() => b.emitWithAck('room:join', 1, 'spectator'), 3000); // Ana keeps using hers
const start = Date.now();
const expired = await new Promise((res) => { a.on('session:expired', () => res(true)); setTimeout(() => res(false), 75_000); });
clearInterval(keepAlive);
await new Promise((r) => setTimeout(r, 300));
console.log(`${expired ? 'PASS' : 'FAIL'}  the idle connection was told its session ended (${Math.round((Date.now() - start) / 1000)}s)`);
const last = presence.at(-1);
const ok = last && last.spectators === 1;
console.log(`${ok ? 'PASS' : 'FAIL'}  the headcount dropped to the one active user  → ${JSON.stringify(last)}`);
process.exit(expired && ok ? 0 : 1);
