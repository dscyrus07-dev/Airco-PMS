/**
 * Central API client.
 *
 * Single boundary for every HTTP request to the FastAPI backend.
 * Handles the base URL (env-configured), auth token attachment, JSON
 * serialization, query params, timeouts, and normalized error mapping.
 *
 * Contract details live in /API.md — this client assumes:
 *   - Bearer token auth (Authorization: Bearer <token>)
 *   - JSON request/response bodies
 *   - FastAPI error envelope: { detail: string | { message, field?, code? }[] }
 */

export const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');

/** Resolve a media path (/uploads/x.jpg) against the API ORIGIN — BASE_URL
    carries the /api/v1 prefix, which is not part of static file paths. */
export const mediaUrl = (p: string) =>
  p.startsWith('http') || !BASE_URL
    ? p
    : `${BASE_URL.replace(/\/api\/v\d+$/, '')}${p}`;
const TOKEN_KEY = 'mgmt_tool_auth_token';
const REFRESH_KEY = 'mgmt_tool_refresh_token';
const DEFAULT_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Token storage — the only session persistence the frontend keeps
// ---------------------------------------------------------------------------

export const getAuthToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setAuthToken = (token: string): void => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable */
  }
};

export const getRefreshToken = (): string | null => {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
};

export const setRefreshToken = (token: string): void => {
  try {
    localStorage.setItem(REFRESH_KEY, token);
  } catch {
    /* storage unavailable */
  }
};

export const clearAuthToken = (): void => {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* noop */
  }
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ApiFieldError = { field?: string; message: string; code?: string };

export class ApiError extends Error {
  status: number;
  fieldErrors: ApiFieldError[];

  constructor(status: number, message: string, fieldErrors: ApiFieldError[] = []) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }

  /** First field-targeted error, e.g. for 422/409 responses. */
  get field(): string | undefined {
    return this.fieldErrors[0]?.field;
  }
}

const normalizeError = (status: number, body: unknown): ApiError => {
  const detail = (body as { detail?: unknown })?.detail;

  // FastAPI 422 shape: { detail: [{ loc: [.., 'field'], msg, type }] }
  if (Array.isArray(detail)) {
    const fieldErrors: ApiFieldError[] = detail.map((d) => ({
      field: Array.isArray(d?.loc) ? String(d.loc[d.loc.length - 1]) : undefined,
      message: d?.msg || d?.message || 'Validation error',
      code: d?.type,
    }));
    return new ApiError(
      status,
      fieldErrors[0]?.message || 'Validation failed.',
      fieldErrors
    );
  }

  if (typeof detail === 'string' && detail) return new ApiError(status, detail);
  if (detail && typeof detail === 'object' && 'message' in (detail as object)) {
    const d = detail as { message: string; field?: string };
    return new ApiError(status, d.message, d.field ? [{ field: d.field, message: d.message }] : []);
  }

  const fallback: Record<number, string> = {
    400: 'The request was invalid.',
    401: 'Your session has expired. Please sign in again.',
    403: 'You do not have permission to perform this action.',
    404: 'The requested resource was not found.',
    409: 'This conflicts with an existing record.',
    422: 'Please check the submitted values.',
    500: 'A server error occurred. Please try again.',
  };
  return new ApiError(status, fallback[status] || `Request failed (${status}).`);
};

// ---------------------------------------------------------------------------
// Unauthorized handler — AppContext registers a session-expired callback
// ---------------------------------------------------------------------------

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  onUnauthorized = handler;
};

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Token refresh — on a 401, try POST /auth/refresh once, then retry the call
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken || !BASE_URL) return false;
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) return false;
    setAuthToken(data.access_token);
    return true;
  } catch {
    return false;
  }
}

const refreshOnce = (): Promise<boolean> => {
  if (!refreshInFlight) {
    refreshInFlight = tryRefreshToken().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
};

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** URL query params — undefined/null/empty values are skipped */
  query?: object;
  /** FormData body (file uploads) — bypasses JSON serialization */
  formData?: FormData;
  timeoutMs?: number;
  /** Internal: prevents infinite 401→refresh→retry loops */
  _retried?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!BASE_URL) {
    throw new ApiError(
      0,
      'API base URL is not configured. Set VITE_API_URL in the environment.'
    );
  }

  const { method = 'GET', body, query, formData, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined && !formData) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, 'The request timed out. Please try again.');
    }
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) {
    // Attempt a refresh-token exchange once before giving up the session
    if (!options._retried && getRefreshToken() && (await refreshOnce())) {
      return apiFetch<T>(path, { ...options, _retried: true });
    }
    clearAuthToken();
    onUnauthorized?.();
    throw new ApiError(401, 'Your session has expired. Please sign in again.');
  }

  if (!response.ok) {
    let bodyJson: unknown = null;
    try {
      bodyJson = await response.json();
    } catch {
      /* non-JSON error body */
    }
    throw normalizeError(response.status, bodyJson);
  }

  if (response.status === 204) return undefined as T;

  try {
    return (await response.json()) as T;
  } catch {
    return undefined as T; // empty 200 body
  }
}
