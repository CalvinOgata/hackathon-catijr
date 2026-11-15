import { SESSION_INVALID } from '@auction/shared';

export const API_URL: string = import.meta.env.VITE_API_URL ?? '';

let token: string | null = null;

/** The session token sent with every request and live connection. */
export const authToken = () => token;

export function setAuthToken(value: string | null) {
  token = value;
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
  const isForm = body instanceof FormData; // the browser sets the multipart boundary itself
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
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
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
};
