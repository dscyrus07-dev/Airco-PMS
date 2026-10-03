/**
 * Central API client — the single boundary for every HTTP request to the
 * FastAPI backend. Mirrors the web client's contract:
 *   - Bearer token auth
 *   - JSON request/response bodies
 *   - FastAPI error envelope: { detail: string | { message, field? } | [{loc,msg,type}] }
 *   - On 401: one refresh attempt (single-flight), one retry, then sign-out.
 *
 * Nothing outside this file (and media.ts's XHR upload) touches fetch.
 */

import { API_BASE_URL, API_ORIGIN, REQUEST_TIMEOUT_MS } from '@/constants/config';

export interface ApiFieldError {
  field?: string;
  message: string;
  code?: string;
}

export class ApiError extends Error {
  status: number;
  fieldErrors: ApiFieldError[];

  constructor(status: number, message: string, fieldErrors: ApiFieldError[] = []) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }

  get field(): string | undefined {
    return this.fieldErrors[0]?.field;
  }

  /** status 0 — network failure / timeout, no HTTP response arrived. */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

// ---------------------------------------------------------------------------
// Wiring — session store registers token access + session-expiry callback
// ---------------------------------------------------------------------------

type TokenGetter = () => Promise<string | null>;
type Refresher = () => Promise<boolean>;

let getAccessToken: TokenGetter = async () => null;
let doRefresh: Refresher = async () => false;
let onSessionExpired: () => void = () => {};

export const configureApi = (opts: {
  getAccessToken: TokenGetter;
  doRefresh: Refresher;
  onSessionExpired: () => void;
}) => {
  getAccessToken = opts.getAccessToken;
  doRefresh = opts.doRefresh;
  onSessionExpired = opts.onSessionExpired;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const FALLBACK_MESSAGES: Record<number, string> = {
  400: 'The request was invalid.',
  401: 'Your session has expired. Please sign in again.',
  403: 'You do not have permission to perform this action.',
  404: 'Not found.',
  409: 'This conflicts with the current state. Refresh and try again.',
  422: 'Please check the submitted values.',
  429: 'Too many requests — please wait a moment and try again.',
  500: 'A server error occurred. Please try again.',
  502: 'The server is unavailable right now. Please try again.',
  503: 'The server is unavailable right now. Please try again.',
};

const normalizeError = (status: number, body: unknown): ApiError => {
  const detail = (body as { detail?: unknown } | null)?.detail;

  // FastAPI 422 shape: { detail: [{ loc: [.., 'field'], msg, type }] }
  if (Array.isArray(detail)) {
    const fieldErrors: ApiFieldError[] = detail.map((d) => ({
      field: Array.isArray(d?.loc) ? String(d.loc[d.loc.length - 1]) : undefined,
      message: d?.msg || d?.message || 'Validation error',
      code: d?.type,
    }));
    return new ApiError(status, fieldErrors[0]?.message || 'Validation failed.', fieldErrors);
  }

  if (typeof detail === 'string' && detail) return new ApiError(status, detail);
  if (detail && typeof detail === 'object' && 'message' in detail) {
    const d = detail as { message: string; field?: string };
    return new ApiError(status, d.message, d.field ? [{ field: d.field, message: d.message }] : []);
  }

  return new ApiError(status, FALLBACK_MESSAGES[status] ?? `Request failed (${status}).`);
};

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

type Query = Record<string, string | number | boolean | null | undefined>;

const buildUrl = (path: string, query?: Query): string => {
  const url = `${API_BASE_URL}${path}`;
  if (!query) return url;
  const params = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return params.length ? `${url}?${params.join('&')}` : url;
};

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Query;
  body?: unknown;
  /** false for /auth/login and /auth/refresh themselves. */
  auth?: boolean;
  timeoutMs?: number;
  /** internal — set by the retry pass so we only refresh once per call. */
  _retried?: boolean;
}

export async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { method = 'GET', query, body, auth = true, timeoutMs = REQUEST_TIMEOUT_MS } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const token = await getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 401 && auth && !opts._retried) {
      if (await doRefresh()) return apiFetch<T>(path, { ...opts, _retried: true });
      onSessionExpired();
      throw new ApiError(401, FALLBACK_MESSAGES[401]);
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (!res.ok) throw normalizeError(res.status, data);
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(0, 'The request timed out. Check your connection and try again.');
    }
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Resolve a media path (/uploads/x.jpg) against the API origin — absolute
 *  storage URLs pass through untouched. */
export const mediaUrl = (p: string): string => (p.startsWith('http') ? p : `${API_ORIGIN}${p}`);
