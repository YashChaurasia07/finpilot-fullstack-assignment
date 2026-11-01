import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request, setUnauthorizedHandler } from './client';
import { shouldRetry } from './queryClient';

const respond = (status: number, body: unknown, raw = false) =>
  vi.fn().mockResolvedValue(new Response(raw ? String(body) : JSON.stringify(body), { status, headers: { 'Content-Type': raw ? 'text/html' : 'application/json' } }));

afterEach(() => setUnauthorizedHandler(undefined));

describe('request', () => {
  it('unwraps the success envelope (data + meta) and sends the session cookie', async () => {
    const fetchMock = respond(200, { success: true, data: [{ a: 1 }], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    vi.stubGlobal('fetch', fetchMock);
    const result = await request<{ a: number }[]>('/customers', { query: { q: 'sharma', page: 2, empty: '', none: undefined } });
    expect(result).toEqual({ data: [{ a: 1 }], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/customers\?q=sharma&page=2$/); // blank and undefined values are not sent
    expect(init.credentials).toBe('include');
  });

  it('sends JSON bodies with the right header and method', async () => {
    const fetchMock = respond(201, { success: true, data: { goalId: 'G1' } });
    vi.stubGlobal('fetch', fetchMock);
    await request('/customers/C1/goals', { json: { goalName: 'x' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"goalName":"x"}');
  });

  it('turns an error envelope into an ApiError with code, field details and request id', async () => {
    vi.stubGlobal('fetch', respond(400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ field: 'targetAmount', message: 'Must be greater than 0' }], requestId: 'req-1' } }));
    const err = await request('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', requestId: 'req-1', retryable: false });
    expect(err.fieldErrors).toEqual([{ field: 'targetAmount', message: 'Must be greater than 0' }]);
  });

  it('reports a network failure as a retryable ApiError, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await request('/x').catch((e) => e);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR', retryable: true });
    expect(err.message).toMatch(/cannot reach the server/i);
  });

  it.each([
    [502, '<html>Bad gateway</html>', /ran into a problem/i, true],
    [404, '<html>nope</html>', /unexpected response/i, false],
  ])('copes with a non-JSON %i page from a proxy', async (status, body, message, retryable) => {
    vi.stubGlobal('fetch', respond(status, body, true));
    const err = await request('/x').catch((e) => e);
    expect(err).toMatchObject({ status, code: 'BAD_RESPONSE', retryable });
    expect(err.message).toMatch(message);
  });

  it('treats a 200 that is not the envelope as a bad response', async () => {
    vi.stubGlobal('fetch', respond(200, { hello: 'world' }));
    await expect(request('/x')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('calls the unauthorized handler for a 401 outside /auth, but not for a failed sign-in', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    const unauthorized = { success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue', requestId: 'r' } };
    vi.stubGlobal('fetch', respond(401, unauthorized));
    await request('/customers').catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
    await request('/auth/login', { json: {} }).catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('lets a deliberate cancel through untouched', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => { controller.abort(); return Promise.reject(new DOMException('aborted', 'AbortError')); }));
    const err = await request('/x', { signal: controller.signal }).catch((e) => e);
    expect(err).not.toBeInstanceOf(ApiError);
    expect(err.name).toBe('AbortError');
  });
});

describe('shouldRetry', () => {
  it('retries network errors and 5xx twice, never client errors', () => {
    expect(shouldRetry(0, new ApiError(0, 'NETWORK_ERROR', 'x'))).toBe(true);
    expect(shouldRetry(1, new ApiError(503, 'SERVICE_UNAVAILABLE', 'x'))).toBe(true);
    expect(shouldRetry(2, new ApiError(503, 'SERVICE_UNAVAILABLE', 'x'))).toBe(false);
    for (const status of [400, 401, 403, 404, 409, 429]) expect(shouldRetry(0, new ApiError(status, 'X', 'x'))).toBe(false);
  });
});
