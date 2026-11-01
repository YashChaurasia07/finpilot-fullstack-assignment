import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import YAML from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import * as customerService from '../../src/services/customers';
import { API, expectFailure, expectSuccess, pool, signIn } from '../helpers';
import { testEnv, VIEWER } from '../testEnv';

const app = createApp();
afterEach(() => vi.restoreAllMocks());

describe('health', () => {
  it('reports ok with a database check, without secrets', async () => {
    const res = await request(app).get(`${API}/health`).expect(200);
    const data = expectSuccess(res.body) as { status: string; checks: { database: { status: string; latencyMs: number } }; version: string };
    expect(data.status).toBe('ok');
    expect(data.checks.database.status).toBe('up');
    expect(data.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(res.body)).not.toMatch(/secret|password|postgres:\/\//i);
  });

  it('returns 503 in the standard error envelope when the database is unreachable', async () => {
    vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    const res = await request(app).get(`${API}/health`).expect(503);
    const error = expectFailure(res.body, 'SERVICE_UNAVAILABLE');
    expect(error.details).toEqual({ checks: { database: { status: 'down' } } });
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5'); // internal addresses are never exposed
  });
});

describe('response headers', () => {
  it('sets security headers, never caches API data, and hides the framework', async () => {
    const res = await request(app).get(`${API}/health`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('echoes a sane X-Request-Id, replaces a hostile one, and uses it in error bodies', async () => {
    const good = await request(app).get(`${API}/customers`).set('X-Request-Id', 'abc-123.test');
    expect(good.headers['x-request-id']).toBe('abc-123.test');
    expect(good.body.error.requestId).toBe('abc-123.test');

    const bad = await request(app).get(`${API}/customers`).set('X-Request-Id', 'bad id\twith\ttabs and "quotes"');
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('every protected endpoint refuses anonymous callers', () => {
  it.each([
    ['get', '/auth/me'],
    ['get', '/customers'],
    ['get', '/customers/C0001'],
    ['get', '/customers/C0001/portfolio'],
    ['get', '/customers/C0001/transactions'],
    ['get', '/customers/C0001/goals'],
    ['post', '/customers/C0001/goals'],
    ['patch', '/goals/G00001'],
    ['get', '/instruments'],
    ['post', '/admin/imports/transactions'],
  ] as const)('%s %s -> 401', async (method, url) => {
    const res = await request(app)[method](`${API}${url}`).expect(401);
    expectFailure(res.body, 'UNAUTHENTICATED');
  });
});

describe('malformed requests get a clean 4xx, never a 500', () => {
  it('unknown routes -> 404 envelope', async () => {
    expectFailure((await request(app).get('/nope').expect(404)).body, 'NOT_FOUND');
  });

  it('invalid JSON -> 400 INVALID_JSON', async () => {
    const res = await request(app).post(`${API}/auth/login`).set('Content-Type', 'application/json').send('{"email": "a@b.c", ').expect(400);
    expectFailure(res.body, 'INVALID_JSON');
  });

  it('JSON body over 100 kb -> 413', async () => {
    const res = await request(app).post(`${API}/auth/login`).send({ email: 'a@b.co', password: 'x'.repeat(150_000) }).expect(413);
    expectFailure(res.body, 'PAYLOAD_TOO_LARGE');
  });

  it('non-JSON write -> 415', async () => {
    const res = await request(app).post(`${API}/auth/login`).set('Content-Type', 'text/plain').send('email=a&password=b').expect(415);
    expectFailure(res.body, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('malformed percent-encoding in a path -> 400', async () => {
    const agent = await signIn(app, 'viewer');
    const res = await agent.get(`${API}/customers/%E0%A4%A`).expect(400);
    expectFailure(res.body, 'BAD_REQUEST');
  });

  it('an unexpected exception -> generic 500 that leaks nothing', async () => {
    const agent = await signIn(app, 'viewer');
    vi.spyOn(customerService, 'searchCustomers').mockRejectedValueOnce(new Error('boom: password=hunter2 at /srv/secret.ts'));
    const res = await agent.get(`${API}/customers`).expect(500);
    const error = expectFailure(res.body, 'INTERNAL_ERROR');
    expect(error.message).not.toMatch(/hunter2|secret|boom/);
  });

  it('a database outage during a request -> 503, not 500', async () => {
    const agent = await signIn(app, 'viewer');
    vi.spyOn(customerService, 'searchCustomers').mockRejectedValueOnce(Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' }));
    expectFailure((await agent.get(`${API}/customers`).expect(503)).body, 'SERVICE_UNAVAILABLE');
  });
});

describe('CSRF and CORS', () => {
  it('rejects a write from an origin that is not on the allow-list', async () => {
    const res = await request(app).post(`${API}/auth/login`).set('Origin', 'https://evil.example').send({ email: VIEWER.email, password: 'x' }).expect(403);
    expectFailure(res.body, 'FORBIDDEN');
  });

  it('accepts writes from allowed origins and from non-browser clients (no Origin header)', async () => {
    const body = { email: VIEWER.email, password: 'wrong-password' };
    await request(app).post(`${API}/auth/login`).set('Origin', 'http://localhost:3000').send(body).expect(401); // reached the handler
    await request(app).post(`${API}/auth/login`).send(body).expect(401);
  });

  it('only allow-listed origins get CORS headers (with credentials)', async () => {
    const ok = await request(app).options(`${API}/customers`).set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await request(app).options(`${API}/customers`).set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('rate limiting', () => {
  it('throttles repeated sign-in attempts with 429 and Retry-After', async () => {
    const limited = createApp({ loginLimit: 3 });
    for (let i = 0; i < 3; i++) await request(limited).post(`${API}/auth/login`).send({ email: VIEWER.email, password: 'wrong' }).expect(401);
    const res = await request(limited).post(`${API}/auth/login`).send({ email: VIEWER.email, password: 'wrong' }).expect(429);
    expectFailure(res.body, 'RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('forged and stale sessions', () => {
  const claims = { role: 'ADMIN' };
  const cookie = (token: string) => `finpilot_token=${token}`;

  it('rejects a token signed with another secret', async () => {
    const token = jwt.sign(claims, randomBytes(32).toString('hex'), { subject: '1', expiresIn: 60 });
    expectFailure((await request(app).get(`${API}/auth/me`).set('Cookie', cookie(token)).expect(401)).body, 'UNAUTHENTICATED');
  });

  it('rejects the "alg: none" trick', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: '1', role: 'ADMIN' })}.`;
    await request(app).get(`${API}/auth/me`).set('Cookie', cookie(token)).expect(401);
  });

  it('rejects an expired token with a helpful message', async () => {
    const token = jwt.sign(claims, testEnv.JWT_SECRET, { subject: '1', expiresIn: -10 });
    const res = await request(app).get(`${API}/auth/me`).set('Cookie', cookie(token)).expect(401);
    expect(expectFailure(res.body, 'UNAUTHENTICATED').message).toMatch(/expired/i);
  });

  it('rejects a token with an unknown role, garbage, and an empty cookie', async () => {
    const odd = jwt.sign({ role: 'SUPERUSER' }, testEnv.JWT_SECRET, { subject: '1', expiresIn: 60 });
    for (const t of [odd, 'not.a.jwt', 'x', '']) await request(app).get(`${API}/auth/me`).set('Cookie', cookie(t)).expect(401);
  });

  it('a valid token for a user that no longer exists is not "signed in"', async () => {
    const token = jwt.sign(claims, testEnv.JWT_SECRET, { subject: '999999', expiresIn: 60 });
    expectFailure((await request(app).get(`${API}/auth/me`).set('Cookie', cookie(token)).expect(401)).body, 'UNAUTHENTICATED');
  });
});

describe('API documentation', () => {
  const spec = YAML.parse(readFileSync(path.join(__dirname, '../../openapi.yaml'), 'utf8'));

  it('serves Swagger UI and the raw OpenAPI file', async () => {
    const ui = await request(app).get(`${API}/docs/`).expect(200);
    expect(ui.text).toContain('swagger-ui');
    const raw = await request(app).get(`${API}/openapi.yaml`).expect(200);
    expect(YAML.parse(raw.text).openapi).toMatch(/^3\./);
  });

  it('documents exactly the endpoints the API serves', () => {
    const documented = Object.entries(spec.paths as Record<string, object>)
      .flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`))
      .sort();
    expect(documented).toEqual(
      [
        'POST /auth/login',
        'POST /auth/logout',
        'GET /auth/me',
        'GET /customers',
        'GET /customers/{customerId}',
        'GET /customers/{customerId}/portfolio',
        'GET /customers/{customerId}/transactions',
        'GET /customers/{customerId}/goals',
        'POST /customers/{customerId}/goals',
        'PATCH /goals/{goalId}',
        'GET /instruments',
        'POST /admin/imports/transactions',
        'GET /health',
      ].sort(),
    );
  });

  it('every documented endpoint really exists (no route-level 404)', async () => {
    const admin = await signIn(app, 'admin');
    const calls: [string, string][] = [
      ['get', '/auth/me'], ['get', '/customers'], ['get', '/customers/C0001'], ['get', '/customers/C0001/portfolio'],
      ['get', '/customers/C0001/transactions'], ['get', '/customers/C0001/goals'], ['post', '/customers/C0001/goals'],
      ['patch', '/goals/G00001'], ['get', '/instruments'], ['post', '/admin/imports/transactions'], ['get', '/health'], ['post', '/auth/logout'],
    ];
    for (const [method, url] of calls) {
      const res = await (admin as never as Record<string, (u: string) => request.Test>)[method](`${API}${url}`);
      expect(res.body?.error?.message ?? '', `${method} ${url}`).not.toMatch(/^Route /);
    }
  });
});
