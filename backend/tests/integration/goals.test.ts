import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { API, customerWhere, expectFailure, expectSuccess, pool, signIn } from '../helpers';

const app = createApp();
let viewer: Awaited<ReturnType<typeof signIn>>;
let admin: Awaited<ReturnType<typeof signIn>>;
let customer: string;
const created: string[] = [];

const valid = { goalType: 'EDUCATION', goalName: 'College fund', targetAmount: 500000, currentFundedAmount: 25000, targetDate: '2035-06-01', priority: 'HIGH' };
const fields = (res: { body: { error: { details: { field: string }[] } } }) => res.body.error.details.map((d) => d.field).sort();

/** Insert a goal straight into the database (the API refuses to create some states, e.g. over-funded or overdue). */
async function insertGoal(over: Record<string, string> = {}): Promise<string> {
  const g = { goal_type: 'TRAVEL', goal_name: 'Seeded for test', target_amount: '1000.00', current_funded_amount: '100.00', target_date: '2035-01-01', priority: 'LOW', ...over };
  const { rows } = await pool.query(
    `insert into goals (customer_id, goal_type, goal_name, target_amount, current_funded_amount, target_date, priority)
     values ($1,$2,$3,$4,$5,$6,$7) returning goal_id`,
    [customer, g.goal_type, g.goal_name, g.target_amount, g.current_funded_amount, g.target_date, g.priority],
  );
  created.push(rows[0].goal_id);
  return rows[0].goal_id;
}

beforeAll(async () => {
  viewer = await signIn(app, 'viewer');
  admin = await signIn(app, 'admin');
  customer = await customerWhere(`exists (select 1 from goals g where g.customer_id = c.customer_id)`);
});
afterAll(async () => {
  await pool.query('delete from goals where goal_id = any($1)', [created]);
});

describe('GET /customers/:id/goals', () => {
  it('lists goals with funded percentage and flags, highest priority first', async () => {
    const res = await viewer.get(`${API}/customers/${customer}/goals`).expect(200);
    const goals = expectSuccess(res.body) as { goalId: string; priority: string; targetAmount: string; currentFundedAmount: string; fundedPct: number; flags: string[]; targetDate: string }[];
    expect(goals.length).toBeGreaterThan(0);
    for (const g of goals) {
      expect(g.fundedPct).toBe(Math.round((Number(g.currentFundedAmount) / Number(g.targetAmount)) * 1000) / 10);
      expect(Array.isArray(g.flags)).toBe(true);
    }
    const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 } as Record<string, number>;
    const ranks = goals.map((g) => rank[g.priority]);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });

  it('returns the seeded goal exactly as stored', async () => {
    const res = await viewer.get(`${API}/customers/C0001/goals`).expect(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({ goalId: 'G00001', goalType: 'WEALTH_CREATION', goalName: 'Family Education', targetAmount: '6076934.41', currentFundedAmount: '5000753.18', targetDate: '2036-01-14', priority: 'LOW', fundedPct: 82.3, flags: [] }),
    ]);
  });

  it('highlights an overdue goal and an over-funded (inconsistent) one', async () => {
    const overdue = await insertGoal({ goal_name: 'Past its date', target_date: '2020-01-01' });
    const over = await insertGoal({ goal_name: 'Too much money', current_funded_amount: '1500.00' });
    const done = await insertGoal({ goal_name: 'Done', current_funded_amount: '1000.00', target_date: '2020-01-01' });
    const goals = (await viewer.get(`${API}/customers/${customer}/goals`).expect(200)).body.data as { goalId: string; flags: string[]; fundedPct: number }[];
    expect(goals.find((g) => g.goalId === overdue)?.flags).toEqual(['OVERDUE']);
    expect(goals.find((g) => g.goalId === over)).toMatchObject({ flags: ['OVER_FUNDED'], fundedPct: 150 });
    expect(goals.find((g) => g.goalId === done)?.flags).toEqual(['COMPLETED']); // funded, so not "overdue"
  });

  it('404 for an unknown customer; [] for a customer without goals', async () => {
    expectFailure((await viewer.get(`${API}/customers/C9999/goals`).expect(404)).body, 'NOT_FOUND');
    const none = await customerWhere(`not exists (select 1 from goals g where g.customer_id = c.customer_id)`).catch(() => null);
    if (none) expect((await viewer.get(`${API}/customers/${none}/goals`).expect(200)).body.data).toEqual([]);
  });
});

describe('POST /customers/:id/goals', () => {
  it.each([['viewer'], ['admin']] as const)('a %s can create a goal (201, Location header, ID continues the G00000 series)', async (who) => {
    const agent = who === 'viewer' ? viewer : admin;
    const res = await agent.post(`${API}/customers/${customer}/goals`).send(valid).expect(201);
    const goal = expectSuccess(res.body) as { goalId: string; fundedPct: number; flags: string[]; targetAmount: string };
    created.push(goal.goalId);
    expect(goal.goalId).toMatch(/^G\d{5,}$/);
    expect(Number(goal.goalId.slice(1))).toBeGreaterThan(177); // after the imported G00001..G00177
    expect(res.headers.location).toBe(`/api/v1/goals/${goal.goalId}`);
    expect(goal).toMatchObject({ customerId: customer, goalName: 'College fund', targetAmount: '500000.00', currentFundedAmount: '25000.00', fundedPct: 5, flags: [] });

    const { rows } = await pool.query('select goal_name, target_amount from goals where goal_id = $1', [goal.goalId]);
    expect(rows[0]).toEqual({ goal_name: 'College fund', target_amount: '500000.00' }); // really persisted, exact decimals
  });

  it('accepts numeric strings and cents, defaults the funded amount to 0, and trims the name', async () => {
    const res = await viewer.post(`${API}/customers/${customer}/goals`).send({ ...valid, goalName: '  Trip  ', targetAmount: '1500.50', currentFundedAmount: undefined }).expect(201);
    created.push(res.body.data.goalId);
    expect(res.body.data).toMatchObject({ goalName: 'Trip', targetAmount: '1500.50', currentFundedAmount: '0.00', fundedPct: 0 });
  });

  it.each([
    ['empty body', {}, ['goalName', 'goalType', 'priority', 'targetAmount', 'targetDate']],
    ['zero target', { targetAmount: 0 }, ['targetAmount']],
    ['negative target', { targetAmount: -1 }, ['targetAmount']],
    ['3 decimals', { targetAmount: 10.123 }, ['targetAmount']],
    ['exponent string', { targetAmount: '1e6' }, ['targetAmount']],
    ['text amount', { targetAmount: 'lots' }, ['targetAmount']],
    ['funded above target', { currentFundedAmount: 600000 }, ['currentFundedAmount']],
    ['negative funded', { currentFundedAmount: -5 }, ['currentFundedAmount']],
    ['date in the past', { targetDate: '2020-01-01' }, ['targetDate']],
    ['date today', { targetDate: new Date().toISOString().slice(0, 10) }, ['targetDate']],
    ['impossible date', { targetDate: '2030-02-31' }, ['targetDate']],
    ['date after 2100', { targetDate: '2101-01-01' }, ['targetDate']],
    ['blank name', { goalName: '   ' }, ['goalName']],
    ['name over 120 chars', { goalName: 'x'.repeat(121) }, ['goalName']],
    ['unknown goal type', { goalType: 'HOLIDAY' }, ['goalType']],
    ['lower-case priority', { priority: 'high' }, ['priority']],
    ['unknown field', { customerId: 'C0002' }, ['customerId']],
    ['several problems at once', { targetAmount: -1, targetDate: 'soon', priority: 'x' }, ['priority', 'targetAmount', 'targetDate']],
  ])('400 with field details for %s', async (_label, change, expected) => {
    const before = (await pool.query('select count(*)::int n from goals')).rows[0].n;
    const body = _label === 'empty body' ? {} : { ...valid, ...change };
    const res = await viewer.post(`${API}/customers/${customer}/goals`).send(body).expect(400);
    expectFailure(res.body, 'VALIDATION_ERROR');
    expect(fields(res)).toEqual(expected);
    expect((await pool.query('select count(*)::int n from goals')).rows[0].n).toBe(before); // nothing was written
  });

  it('400 for a malformed JSON body; 404 for an unknown customer', async () => {
    expectFailure((await viewer.post(`${API}/customers/${customer}/goals`).set('Content-Type', 'application/json').send('{"goalName":').expect(400)).body, 'INVALID_JSON');
    expectFailure((await viewer.post(`${API}/customers/C9999/goals`).send(valid).expect(404)).body, 'NOT_FOUND');
  });

  it('creating many goals at once never produces duplicate IDs', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => viewer.post(`${API}/customers/${customer}/goals`).send(valid)));
    const ids = results.map((r) => r.body.data?.goalId as string);
    created.push(...ids.filter(Boolean));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(ids).size).toBe(8);
  });
});

describe('PATCH /goals/:goalId', () => {
  let goalId: string;
  beforeAll(async () => {
    goalId = await insertGoal({ goal_name: 'Patch me', target_amount: '1000.00', current_funded_amount: '100.00' });
  });

  it('edits only the fields given and bumps updatedAt', async () => {
    const before = (await pool.query('select updated_at from goals where goal_id = $1', [goalId])).rows[0].updated_at as Date;
    await new Promise((r) => setTimeout(r, 15));
    const res = await viewer.patch(`${API}/goals/${goalId}`).send({ goalName: '  Renamed  ', priority: 'HIGH' }).expect(200);
    expect(res.body.data).toMatchObject({ goalId, goalName: 'Renamed', priority: 'HIGH', targetAmount: '1000.00', currentFundedAmount: '100.00' });
    const after = (await pool.query('select updated_at from goals where goal_id = $1', [goalId])).rows[0].updated_at as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it('can change the amounts, the date and the type', async () => {
    const res = await admin.patch(`${API}/goals/${goalId}`).send({ targetAmount: '2000.00', currentFundedAmount: 500, targetDate: '2040-12-31', goalType: 'RETIREMENT' }).expect(200);
    expect(res.body.data).toMatchObject({ targetAmount: '2000.00', currentFundedAmount: '500.00', targetDate: '2040-12-31', goalType: 'RETIREMENT', fundedPct: 25 });
  });

  it.each([
    ['empty patch', {}, ['body']],
    ['funded above the (stored) target', { currentFundedAmount: 5000 }, ['currentFundedAmount']],
    ['target below the (stored) funded amount', { targetAmount: 100 }, ['currentFundedAmount']],
    ['both amounts, inconsistent', { targetAmount: 100, currentFundedAmount: 200 }, ['currentFundedAmount']],
    ['target date in the past', { targetDate: '2020-01-01' }, ['targetDate']],
    ['null instead of a value', { goalName: null }, ['goalName']],
    ['immutable field', { customerId: 'C0002' }, ['customerId']],
    ['unknown field', { colour: 'red' }, ['colour']],
    ['negative amount', { targetAmount: -1 }, ['targetAmount']],
  ])('400 for %s, and the goal is left unchanged', async (_label, patch, expected) => {
    const before = (await pool.query('select * from goals where goal_id = $1', [goalId])).rows[0];
    const res = await viewer.patch(`${API}/goals/${goalId}`).send(patch).expect(400);
    expectFailure(res.body, 'VALIDATION_ERROR');
    expect(fields(res)).toEqual(expected);
    expect((await pool.query('select * from goals where goal_id = $1', [goalId])).rows[0]).toEqual(before);
  });

  it('404 for an unknown or malformed goal id', async () => {
    for (const id of ['G99999', 'nope', 'G1%20OR%201=1', 'G'.repeat(30)]) {
      expectFailure((await viewer.patch(`${API}/goals/${id}`).send({ priority: 'LOW' }).expect(404)).body, 'NOT_FOUND');
    }
  });

  it('still allows renaming an over-funded or overdue goal (only touched rules are re-checked)', async () => {
    const over = await insertGoal({ current_funded_amount: '1500.00' });
    const late = await insertGoal({ target_date: '2020-01-01' });
    expect((await viewer.patch(`${API}/goals/${over}`).send({ goalName: 'Still over' }).expect(200)).body.data.flags).toEqual(['OVER_FUNDED']);
    expect((await viewer.patch(`${API}/goals/${late}`).send({ priority: 'HIGH' }).expect(200)).body.data.flags).toEqual(['OVERDUE']);
    // ...but it cannot be made worse: funded stays above target
    expectFailure((await viewer.patch(`${API}/goals/${over}`).send({ currentFundedAmount: 2000 }).expect(400)).body, 'VALIDATION_ERROR');
  });

  it('two simultaneous edits cannot together break "funded <= target" (row lock)', async () => {
    const id = await insertGoal({ target_amount: '1000.00', current_funded_amount: '100.00' });
    const [a, b] = await Promise.all([
      viewer.patch(`${API}/goals/${id}`).send({ currentFundedAmount: 900 }), // valid alone
      admin.patch(`${API}/goals/${id}`).send({ targetAmount: 500 }), // valid alone
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]); // whichever ran second was checked against the first
    const { rows } = await pool.query('select target_amount, current_funded_amount from goals where goal_id = $1', [id]);
    expect(Number(rows[0].current_funded_amount)).toBeLessThanOrEqual(Number(rows[0].target_amount));
  });
});
