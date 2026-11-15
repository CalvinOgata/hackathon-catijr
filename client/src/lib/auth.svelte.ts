import type { AuthResponse, PublicUser } from '@auction/shared';
import { goto } from '$app/navigation';
import { api, onSessionInvalid, setAuthToken } from './api.ts';
import { reconnectSocket, socket } from './socket.svelte.ts';
import { readStored, writeStored } from './storage.ts';

const TOKEN_KEY = 'auth_token';

class Auth {
  user = $state<PublicUser | null>(null);
  /** False until the stored session has been checked. */
  ready = $state(false);
  /** Tells the user why they were logged out (session expired, account deleted). */
  notice = $state<{ kind: 'error' | 'success'; text: string } | null>(null);

  constructor() {
    // The server is the source of truth for sessions (RF02): any rejection logs us out here
    onSessionInvalid(() => this.expire());
    socket.on('session:expired', () => this.expire());
  }

  async init() {
    const token = readStored<string>('local', TOKEN_KEY);
    if (token) {
      this.#setToken(token);
      try {
        this.user = await api.get<PublicUser>('/auth/me');
      } catch {
        this.#clear();
      }
    }
    this.ready = true;
  }

  async login(email: string, password: string) {
    this.#start(await api.post<AuthResponse>('/auth/login', { email, password }));
  }

  async signup(name: string, email: string, password: string) {
    this.#start(await api.post<AuthResponse>('/auth/signup', { name, email, password }));
  }

  async updateName(name: string) {
    this.user = await api.patch<PublicUser>('/account', { name });
  }

  /** Other sessions of this account are ended by the server; this one stays. */
  async changePassword(currentPassword: string, newPassword: string) {
    await api.put('/account/password', { currentPassword, newPassword });
  }

  logout() {
    // The request captures the current token before we clear it; no need to wait for it
    api.post('/auth/logout').catch(() => {});
    this.#clear();
  }

  expire() {
    if (!this.user) return;
    this.#clear();
    this.notice = { kind: 'error', text: 'Sua sessão expirou. Entre novamente.' };
  }

  /** The server ends every session of the account, this one included. */
  async deleteAccount(password: string, confirmation: string) {
    await api.post('/account/delete', { password, confirmation });
    this.#clear();
    this.notice = { kind: 'success', text: 'Sua conta foi excluída. Seu histórico de leilões foi mantido de forma anônima.' };
  }

  #start({ token, user }: AuthResponse) {
    this.#setToken(token);
    this.user = user;
    this.notice = null;
  }

  #clear() {
    this.user = null;
    this.#setToken(null);
  }

  #setToken(token: string | null) {
    writeStored('local', TOKEN_KEY, token);
    setAuthToken(token);
    reconnectSocket();
  }
}

export const auth = new Auth();

/**
 * For pages that need login (call while the component initializes): guests go to the login page
 * and come back here after. `unless` skips it, e.g. right after deleting the account.
 */
export function requireLogin(unless: () => boolean = () => false) {
  $effect(() => {
    if (auth.ready && !auth.user && !unless()) goto(`/login?redirect=${encodeURIComponent(location.pathname)}`, { replace: true });
  });
}
