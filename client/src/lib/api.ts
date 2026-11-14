import { SESSION_INVALID } from '@auction/shared';

export const API_URL: string = import.meta.env.VITE_API_URL ?? '';

let authToken: string | null = null;

export function setApiToken(token: string | null) {
  authToken = token;
}

let sessionInvalidHandler: (() => void) | null = null;

/** Called whenever the server rejects the session (expired, logged out elsewhere, forged). */
export function onSessionInvalid(handler: () => void) {
  sessionInvalidHandler = handler;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Não foi possível conectar ao servidor. Verifique sua conexão.');
  }
  const data = await res.json().catch(() => null);

  if (res.status === 401 && data?.code === SESSION_INVALID) sessionInvalidHandler?.();
  if (!res.ok) throw new ApiError(res.status, data?.message ?? `Erro inesperado (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
};
