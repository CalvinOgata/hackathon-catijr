import type { PublicUser } from '@auction/shared';
import { saveStore } from '../persistence';
import { nextId, store, type UserRecord } from '../store';

export class EmailTakenError extends Error {}

/** Emails identify accounts (RF01), so they're compared trimmed and case-insensitively. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const toPublicUser = ({ id, name, email, createdAt }: UserRecord): PublicUser => ({
  id,
  name,
  email,
  createdAt: new Date(createdAt).toISOString(),
});

export function findUserByEmail(email: string): (PublicUser & { passwordHash: string }) | undefined {
  const id = store.userIdsByEmail.get(normalizeEmail(email));
  const user = id === undefined ? undefined : store.users.get(id);
  return user && { ...toPublicUser(user), passwordHash: user.passwordHash };
}

export function findUserById(id: number): PublicUser | undefined {
  const user = store.users.get(id);
  return user && toPublicUser(user);
}

export function getPasswordHash(id: number): string | undefined {
  return store.users.get(id)?.passwordHash;
}

export function updateUserName(id: number, name: string): PublicUser {
  const user = store.users.get(id)!;
  user.name = name;
  saveStore();
  return toPublicUser(user);
}

export function updatePasswordHash(id: number, passwordHash: string) {
  store.users.get(id)!.passwordHash = passwordHash;
  saveStore();
}

/**
 * The email check and the insert run synchronously together, so two signups racing
 * each other (both past their slow password hashing) can't both create the account.
 */
export function createUser(data: { name: string; email: string; passwordHash: string }): PublicUser {
  const email = normalizeEmail(data.email);
  if (store.userIdsByEmail.has(email)) throw new EmailTakenError();

  const user: UserRecord = { id: nextId('user'), name: data.name, email, passwordHash: data.passwordHash, createdAt: Date.now() };
  store.users.set(user.id, user);
  store.userIdsByEmail.set(email, user.id);
  saveStore();
  return toPublicUser(user);
}
