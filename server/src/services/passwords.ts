import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Passwords are never stored: only a salted scrypt hash. The cost parameters follow
// one of OWASP's recommended scrypt settings (N=2^14, r=8, p=5) and are kept inside
// each hash, so they can be raised later without breaking existing accounts.
const PARAMS = { N: 2 ** 14, r: 8, p: 5 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function derive(password: string, salt: Buffer, params: typeof PARAMS, keyLength: number): Promise<Buffer> {
  const options: ScryptOptions = { ...params, maxmem: 256 * params.N * params.r };
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFC'), salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Returns `scrypt$N$r$p$salt$hash` (salt and hash in base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, PARAMS, KEY_LENGTH);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, N, r, p, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;

  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), { N: Number(N), r: Number(r), p: Number(p) }, expected.length);
  return timingSafeEqual(expected, actual);
}

let dummyHash: Promise<string> | undefined;

/**
 * A real hash to verify against when the email doesn't exist, so a failed login
 * takes the same time either way and doesn't reveal which emails have accounts.
 */
export const hashForMissingUser = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));
