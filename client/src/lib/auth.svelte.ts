import type { AuthResponse, PublicUser } from '@auction/shared';
import { api, onSessionInvalid, setApiToken } from './api.ts';
import { setSocketToken, socket } from './socket.svelte.ts';

const TOKEN_KEY = 'auth_token';

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode): the session just won't persist
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

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
    const token = readToken();
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
    storeToken(token);
    setApiToken(token);
    setSocketToken(token);
  }
}

export const auth = new Auth();
