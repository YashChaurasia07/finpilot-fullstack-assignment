import type { FieldError, Meta } from './types';

/** The one error type the UI deals with, whatever went wrong (validation, auth, network, proxy page...). */
export class ApiError extends Error {
  constructor(
    public readonly status: number, // 0 = the request never got an HTTP response
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages from a 400, for showing next to the inputs. */
  get fieldErrors(): FieldError[] {
    return Array.isArray(this.details) ? (this.details as FieldError[]) : [];
  }

  /** Worth offering a "Try again" button (the problem may be temporary). */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

type Envelope<T> =
  | { success: true; data: T; meta?: Meta }
  | { success: false; error: { code: string; message: string; details?: unknown; requestId?: string } };

const BASE = '/api/v1';
const TIMEOUT_MS = 30_000;

let onUnauthorized: (() => void) | undefined;
/** Called when a signed-in session turns out to be expired (any 401 outside the /auth endpoints). */
export const setUnauthorizedHandler = (handler: (() => void) | undefined) => {
  onUnauthorized = handler;
};

export interface RequestOptions {
  method?: string;
  json?: unknown;
  body?: FormData;
  query?: Record<string, string | number | null | undefined>;
  signal?: AbortSignal;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<{ data: T; meta?: Meta }> {
  const url = new URL(BASE + path, window.location.origin);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const hasJson = opts.json !== undefined;

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (hasJson || opts.body ? 'POST' : 'GET'),
      credentials: 'include',
      signal,
      headers: hasJson ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: hasJson ? JSON.stringify(opts.json) : opts.body,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err; // cancelled on purpose (e.g. the user navigated away): not an error to show
    if (timeout.aborted) throw new ApiError(0, 'TIMEOUT', 'The server took too long to respond. Please try again.');
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }

  let body: Envelope<T> | undefined;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    // not JSON, e.g. a 502 page from a proxy
  }

  if (res.ok && body?.success === true) return { data: body.data, meta: body.meta };

  if (body?.success === false) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    throw new ApiError(res.status, body.error.code, body.error.message, body.error.details, body.error.requestId);
  }
  throw new ApiError(
    res.status,
    'BAD_RESPONSE',
    res.status >= 500 ? 'The server ran into a problem. Please try again shortly.' : `Unexpected response from the server (HTTP ${res.status}).`,
  );
}
