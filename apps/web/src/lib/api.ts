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
  let res = await send(path, options);

  // An access token lasts about an hour. The Supabase client refreshes in the
  // background, but it cannot while the tab is asleep or the machine is
  // suspended, so a session left open overnight comes back with a token the
  // gateway rejects.
  //
  // Without this the page did not recover: every request failed with "Invalid
  // or expired token" and the only way out was to sign out and back in, which
  // looks like the app has broken rather than like a session that lapsed.
  if (res.status === 401) {
    const recovered = await refreshSession();
    if (recovered) {
      res = await send(path, options);
    } else {
      // The refresh token is spent too. End the session deliberately so the
      // app shows the sign-in page instead of a wall of errors.
      await supabase.auth.signOut();
      throw new ApiError('Your session has expired. Please sign in again.', 401);
    }
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

async function send(path: string, options: RequestInit): Promise<Response> {
  const headers = await getAuthHeaders();
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection.', 0);
  }
}

// Several requests usually fail together when a token lapses -- a page loads
// three endpoints at once -- and each must not start its own refresh. They
// share this one promise instead, so the refresh token is spent once.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = supabase.auth
      .refreshSession()
      .then(({ data, error }) => Boolean(data.session) && !error)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
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
