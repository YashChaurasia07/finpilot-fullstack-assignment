import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/db/client';
import { ADMIN, VIEWER } from './testEnv';

export const API = '/api/v1';
export { pool };

export type TestApp = ReturnType<typeof createApp>;

/** A supertest agent that has signed in (it keeps the session cookie between calls). */
export async function signIn(app: TestApp, who: 'admin' | 'viewer') {
  const agent = request.agent(app);
  const { email, password } = who === 'admin' ? ADMIN : VIEWER;
  await agent.post(`${API}/auth/login`).send({ email, password }).expect(200);
  return agent;
}

/** Every response, success or failure, must use the shared envelope. */
export function expectSuccess(body: Record<string, unknown>) {
  if (body.success !== true || !('data' in body)) throw new Error(`Not a success envelope: ${JSON.stringify(body)}`);
  return body.data as never;
}

export function expectFailure(body: Record<string, unknown>, code: string) {
  const error = body.error as { code: string; message: string; requestId: string; details?: unknown } | undefined;
  if (body.success !== false || !error) throw new Error(`Not an error envelope: ${JSON.stringify(body)}`);
  if (error.code !== code) throw new Error(`Expected error code ${code}, got ${error.code} (${error.message})`);
  if (typeof error.requestId !== 'string' || !error.requestId) throw new Error('Error envelope is missing requestId');
  if ('stack' in error || JSON.stringify(body).includes('node_modules')) throw new Error('Error response leaks internals');
  return error;
}

/** First customer (by id) matching a SQL condition, so tests rely on the data's shape, not on hard-coded IDs. */
export async function customerWhere(condition: string): Promise<string> {
  const { rows } = await pool.query(`select customer_id from customers c where ${condition} order by customer_id limit 1`);
  if (!rows[0]) throw new Error(`No customer matches: ${condition}`);
  return rows[0].customer_id as string;
}
