// The account page: password policy, the wrong-password limit and lock, renaming, changing the
// password (other sessions end, this one stays).
import { URL, check, finish, sleep, api, io } from './lib.mjs';

const signup = (name, email, password) => api('POST', '/auth/signup', { name, email, password });
const login = (email, password) => api('POST', '/auth/login', { email, password });
const STRONG = 'Segura#2026';

console.log('\n== Password policy (server is the authority)');
for (const [label, pw] of [['too short', 'Ab1!'], ['no lowercase', 'SEGURA#2026'], ['no uppercase', 'segura#2026'], ['no number', 'Segura#Senha'], ['no symbol', 'Segura2026'], ['too long', 'Aa1!' + 'x'.repeat(130)]]) {
  const r = await signup('Teste', `weak-${label.replace(/ /g, '')}@test.com`, pw);
  check(`signup rejects password with ${label}`, r.status === 400, r.body.message);
}
let r = await signup('Ana Lima', 'ana@test.com', STRONG);
check('strong password accepted', r.status === 201 && !!r.body.user.createdAt, `createdAt ${r.body.user?.createdAt}`);
check('response never includes the password or its hash', !JSON.stringify(r.body).match(/Segura|passwordHash|scrypt/));

console.log('\n== Login attempt limit (3, then locked for 6s)');
r = await login('ana@test.com', 'Errada#1');
check('1st wrong password → 401, 2 left', r.status === 401, r.body.message);
r = await login('ANA@test.com', 'Errada#2');
check('2nd wrong password → 401, 1 left (email case ignored)', r.status === 401, r.body.message);
r = await login('ana@test.com', 'Errada#3');
check('3rd wrong password → locked (429)', r.status === 429 && r.headers.get('retry-after') === '6', r.body.message);
r = await login('ana@test.com', STRONG);
check('correct password also refused while locked', r.status === 429);
r = await login('bia@test.com', 'Qualquer#1');
check('other emails are not affected', r.status === 401);
await sleep(6500);
r = await login('ana@test.com', STRONG);
check('after the lock expires, correct password works', r.status === 200);
r = await login('ana@test.com', 'Errada#4');
check('a success resets the streak (back to 2 left)', r.status === 401 && r.body.message.includes('Restam 2'), r.body.message);

console.log('\n== Simultaneous wrong attempts can\'t get past the limit');
await signup('Caio', 'caio@test.com', STRONG);
const burst = await Promise.all(Array.from({ length: 10 }, (_, i) => login('caio@test.com', `Chute#${i}`)));
const codes = burst.map((x) => x.status);
check('10 parallel wrong passwords → at most 3 checked, rest locked', codes.filter((c) => c === 401).length <= 2 && codes.filter((c) => c === 429).length >= 8, codes.join(','));

console.log('\n== Unknown emails behave like real ones (no account enumeration)');
const ghost = await Promise.all([1, 2, 3].map(async () => (await login('ninguem@test.com', 'Errada#1'))));
const known = await Promise.all([1, 2, 3].map(async () => (await login('dora@test.com', 'Errada#1'))));
check('unknown email gets the same responses', JSON.stringify(ghost.map((x) => x.status).sort()) === JSON.stringify(known.map((x) => x.status).sort()), ghost.map((x) => x.status).join(','));

console.log('\n== My account');
await sleep(6500);
r = await login('ana@test.com', STRONG);
const token = r.body.token;
const other = (await login('ana@test.com', STRONG)).body.token;
const otherSocket = await new Promise((res) => { const s = io(URL, { auth: { token: other }, forceNew: true }); s.on('connect', () => res(s)); });
let otherExpired = false;
otherSocket.on('session:expired', () => (otherExpired = true));

r = await api('PATCH', '/account', { name: '   Ana    Lima Souza  ' }, token);
check('rename (spaces normalized)', r.status === 200 && r.body.name === 'Ana Lima Souza', r.body.name);
r = await api('GET', '/auth/me', null, token);
check('/me reflects new name and has createdAt', r.body.name === 'Ana Lima Souza' && !!r.body.createdAt);
r = await api('PATCH', '/account', { name: 'A' }, token);
check('rename too short rejected', r.status === 400, r.body.message);
r = await api('PATCH', '/account', { name: 'Hacker' });
check('rename without session → 401', r.status === 401);

r = await api('PUT', '/account/password', { currentPassword: STRONG, newPassword: 'fraca' }, token);
check('new password must follow the policy', r.status === 400, r.body.message);
r = await api('PUT', '/account/password', { currentPassword: STRONG, newPassword: STRONG }, token);
check('new password must differ from current', r.status === 400, r.body.message);
r = await api('PUT', '/account/password', { currentPassword: 'Errada#9', newPassword: 'Nova#Senha2026' }, token);
check('wrong current password → 403 with attempts left', r.status === 403, r.body.message);
r = await api('PUT', '/account/password', { currentPassword: STRONG, newPassword: 'Nova#Senha2026' }, token);
check('password changed', r.status === 204);
await sleep(150);
check('other session ended (HTTP)', (await api('GET', '/auth/me', null, other)).status === 401);
check('other session\'s open socket told it ended', otherExpired);
check('current session still valid', (await api('GET', '/auth/me', null, token)).status === 200);
check('old password no longer logs in', (await login('ana@test.com', STRONG)).status === 401);
check('new password logs in', (await login('ana@test.com', 'Nova#Senha2026')).status === 200);

otherSocket.close();
finish();
