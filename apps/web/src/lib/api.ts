import { supabase } from './supabase';

/**
 * Resolves to the "/api" prefix the gateway mounts its routers under.
 *
 * In development VITE_API_URL is unset and Vite proxies "/api" to port 3001.
 * In production it is the gateway origin (e.g. https://ayira-api.up.railway.app),
 * so the prefix is appended here and every caller passes a bare path
 * like "/gigs" rather than repeating "/api".
 */
function resolveApiBase(): string {
  const configured = import.meta.env.VITE_API_URL;
  if (!configured) return '/api';
  return `${configured.replace(/\/+$/, '').replace(/\/api$/, '')}/api`;
}

const API_BASE = resolveApiBase();

async function getAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return {
    'Content-Type': 'application/json',
    ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
  };
}

/** The envelope every gateway route returns on success. */
interface ApiEnvelope<T> {
  data: T;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
    this.name = 'ApiError';
  }
}

/**
 * Calls the API gateway with the caller's Supabase JWT attached and unwraps the
 * `{ data }` envelope, so callers work with the payload directly.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getAuthHeaders();

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection.', 0);
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'error' in body && String(body.error)) ||
      `Request failed (${res.status})`;
    const details =
      body && typeof body === 'object' && 'details' in body ? body.details : undefined;
    throw new ApiError(message, res.status, details);
  }

  return (body as ApiEnvelope<T>)?.data as T;
}

/** Serialises query params, dropping empty values so filters stay optional. */
export function toQueryString(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}
