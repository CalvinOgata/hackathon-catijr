import { DELETED_ACCOUNT_NAME, DISPLAY_NAME_LENGTH, normalizeDisplayName, passwordProblems, type PublicUser } from '@auction/shared';
import { AppError } from '../errors';
import { transaction } from '../persistence';
import { nextId, store, type UserRecord } from '../store';

/** Emails identify accounts (RF01), so they're compared trimmed and case-insensitively. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const toPublicUser = ({ id, name, email, createdAt }: UserRecord): PublicUser => ({
  id,
  name,
  email,
  createdAt: new Date(createdAt).toISOString(),
});

/** The display name as it will be saved, or a 400 when it's out of bounds. */
export function parseDisplayName(raw: string): string {
  const name = normalizeDisplayName(raw);
  const { min, max } = DISPLAY_NAME_LENGTH;
  if (name.length < min || name.length > max) throw new AppError(400, `O nome de exibição deve ter de ${min} a ${max} caracteres`);
  return name;
}

/** A 400 when a new password breaks the policy. */
export function checkNewPassword(password: string) {
  const problems = passwordProblems(password);
  if (problems.length) throw new AppError(400, `A senha precisa ter: ${problems.map((p) => p.toLowerCase()).join(', ')}`);
}

export function findUserByEmail(email: string): UserRecord | undefined {
  const id = store.userIdsByEmail.get(normalizeEmail(email));
  return id === undefined ? undefined : store.users.get(id);
}

/** Only for ids that exist (e.g. from a valid session). */
export const getUser = (id: number): UserRecord => store.users.get(id)!;

/**
 * The email check and the insert run synchronously together, so two signups racing
 * each other (both past their slow password hashing) can't both create the account.
 */
export function createUser(data: { name: string; email: string; passwordHash: string }): UserRecord {
  const email = normalizeEmail(data.email);
  if (store.userIdsByEmail.has(email)) throw new AppError(409, 'Já existe uma conta com este e-mail');

  const user: UserRecord = { id: nextId('user'), name: data.name, email, passwordHash: data.passwordHash, createdAt: Date.now(), deletedAt: null };
  transaction(() => {
    store.users.set(user.id, user);
    store.userIdsByEmail.set(email, user.id);
  });
  return user;
}

export function updateUser(id: number, changes: Partial<Pick<UserRecord, 'name' | 'passwordHash'>>): UserRecord {
  const user = getUser(id);
  transaction(() => Object.assign(user, changes));
  return user;
}

/**
 * Deletes an account without erasing history: auctions, bids and results stay (RF08 says
 * nothing is deleted; results, profiles and purchase history depend on them), but now point
 * to an anonymous "Conta excluída". The email is released, so it can be used for a new
 * account later, and login becomes impossible (there is no password hash left to match).
 */
export function anonymizeUser(id: number) {
  const user = getUser(id);
  transaction(() => {
    store.userIdsByEmail.delete(user.email);
    Object.assign(user, { name: DELETED_ACCOUNT_NAME, email: `excluida-${user.id}@invalid`, passwordHash: '', deletedAt: Date.now() });
  });
}
