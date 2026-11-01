import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { API, expectFailure, expectSuccess, signIn } from '../helpers';
import { ADMIN, VIEWER } from '../testEnv';

const app = createApp();

describe('POST /auth/login', () => {
  it('signs in, returns the user (never the password hash) and sets a hardened session cookie', async () => {
    const res = await request(app).post(`${API}/auth/login`).send(VIEWER).expect(200);
    const data = expectSuccess(res.body) as { user: Record<string, unknown> };
    expect(data.user).toEqual({ id: expect.any(Number), email: VIEWER.email, fullName: 'Demo Viewer', role: 'VIEWER' });
    expect(JSON.stringify(res.body)).not.toMatch(/hash|\$2[aby]\$/i);

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('finpilot_token='))!;
    expect(cookie).toMatch(/HttpOnly/i); // not readable by page scripts, so XSS cannot steal it
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=28800/); // 8 hours
    expect(cookie).not.toMatch(/Secure/i); // COOKIE_SECURE=false in the test environment
  });

  it('is case- and whitespace-insensitive for the email', async () => {
    await request(app).post(`${API}/auth/login`).send({ email: `  ${VIEWER.email.toUpperCase()} `, password: VIEWER.password }).expect(200);
  });

  it('gives the same answer for a wrong password and an unknown user (no user enumeration)', async () => {
    const wrong = await request(app).post(`${API}/auth/login`).send({ email: VIEWER.email, password: 'wrong-password' }).expect(401);
    const unknown = await request(app).post(`${API}/auth/login`).send({ email: 'nobody@finpilot.test', password: 'wrong-password' }).expect(401);
    expect(expectFailure(wrong.body, 'INVALID_CREDENTIALS').message).toBe(expectFailure(unknown.body, 'INVALID_CREDENTIALS').message);
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it.each([
    ['empty body', {}, ['email', 'password']],
    ['missing password', { email: VIEWER.email }, ['password']],
    ['invalid email', { email: 'not-an-email', password: 'x' }, ['email']],
    ['empty password', { email: VIEWER.email, password: '' }, ['password']],
    ['password too long (bcrypt would truncate it)', { email: VIEWER.email, password: 'é'.repeat(40) }, ['password']],
    ['password of the wrong type', { email: VIEWER.email, password: 12345678 }, ['password']],
    ['extra field', { ...VIEWER, role: 'ADMIN' }, ['role']],
  ])('400 with field details for %s', async (_label, body, fields) => {
    const res = await request(app).post(`${API}/auth/login`).send(body).expect(400);
    const error = expectFailure(res.body, 'VALIDATION_ERROR');
    expect((error.details as { field: string }[]).map((d) => d.field).sort()).toEqual([...fields].sort());
  });

  it('400 when the body is a JSON array', async () => {
    expectFailure((await request(app).post(`${API}/auth/login`).send([VIEWER]).expect(400)).body, 'VALIDATION_ERROR');
  });
});

describe('session lifecycle', () => {
  it('/auth/me returns the signed-in user, and logout ends the session', async () => {
    const agent = await signIn(app, 'admin');
    const me = await agent.get(`${API}/auth/me`).expect(200);
    expect((expectSuccess(me.body) as { user: { email: string; role: string } }).user).toMatchObject({ email: ADMIN.email, role: 'ADMIN' });

    const out = await agent.post(`${API}/auth/logout`).expect(200);
    expect(expectSuccess(out.body)).toEqual({ loggedOut: true });
    expect((out.headers['set-cookie'] as unknown as string[])[0]).toMatch(/finpilot_token=;/); // cleared
    await agent.get(`${API}/auth/me`).expect(401);
  });

  it('logout is harmless when nobody is signed in', async () => {
    await request(app).post(`${API}/auth/logout`).expect(200);
  });
});

describe('roles', () => {
  it('a VIEWER cannot reach admin endpoints (403), an ADMIN can', async () => {
    const viewer = await signIn(app, 'viewer');
    expectFailure((await viewer.post(`${API}/admin/imports/transactions`).expect(403)).body, 'FORBIDDEN');

    const admin = await signIn(app, 'admin');
    const res = await admin.post(`${API}/admin/imports/transactions`).expect(400); // allowed in, but no file attached
    expectFailure(res.body, 'FILE_REQUIRED');
  });

  it('both roles can read customer data', async () => {
    for (const who of ['viewer', 'admin'] as const) await (await signIn(app, who)).get(`${API}/customers`).expect(200);
  });
});
