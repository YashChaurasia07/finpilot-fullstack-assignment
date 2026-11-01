import { describe, expect, it } from 'vitest';
import '../../src/lib/zod';
import { fieldErrors } from '../../src/middleware/errors';
import { createGoalSchema, goalView, patchGoalSchema, type GoalRow } from '../../src/services/goals';

const TODAY = '2026-10-31';
const goal = (over: Partial<GoalRow> = {}): GoalRow => ({
  goalId: 'G00001',
  customerId: 'C0001',
  goalType: 'RETIREMENT',
  goalName: 'Primary Retirement',
  targetAmount: '1000.00',
  currentFundedAmount: '250.00',
  targetDate: '2030-01-01',
  priority: 'HIGH',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('goalView', () => {
  it('computes funded percentage to one decimal', () => {
    expect(goalView(goal({ targetAmount: '3.00', currentFundedAmount: '1.00' }), TODAY).fundedPct).toBe(33.3);
    expect(goalView(goal(), TODAY).fundedPct).toBe(25);
    expect(goalView(goal({ currentFundedAmount: '0.00' }), TODAY).fundedPct).toBe(0);
  });

  it('has no flags for a normal goal', () => expect(goalView(goal(), TODAY).flags).toEqual([]));

  it('flags OVERDUE when the date has passed and the goal is not fully funded', () => {
    expect(goalView(goal({ targetDate: '2026-10-30' }), TODAY).flags).toEqual(['OVERDUE']);
  });

  it('does not flag a goal due today, or a funded goal whose date passed, as overdue', () => {
    expect(goalView(goal({ targetDate: TODAY }), TODAY).flags).toEqual([]);
    expect(goalView(goal({ targetDate: '2020-01-01', currentFundedAmount: '1000.00' }), TODAY).flags).toEqual(['COMPLETED']);
  });

  it('flags COMPLETED at exactly the target and OVER_FUNDED above it', () => {
    expect(goalView(goal({ currentFundedAmount: '1000.00' }), TODAY).flags).toEqual(['COMPLETED']);
    expect(goalView(goal({ currentFundedAmount: '1200.00' }), TODAY)).toMatchObject({ flags: ['OVER_FUNDED'], fundedPct: 120 });
  });

  it('can combine flags (over-funded and past its date is not overdue, because it is funded)', () => {
    expect(goalView(goal({ currentFundedAmount: '1200.00', targetDate: '2020-01-01' }), TODAY).flags).toEqual(['OVER_FUNDED']);
  });
});

const valid = { goalType: 'EDUCATION', goalName: 'College', targetAmount: 500000, currentFundedAmount: 1000, targetDate: '2035-06-01', priority: 'HIGH' };
// Same mapping the API uses, so these are exactly the messages a client would see.
const messages = (r: { success: boolean; error?: Parameters<typeof fieldErrors>[0] }) =>
  r.success || !r.error ? [] : fieldErrors(r.error).map((e) => `${e.field}: ${e.message}`);

describe('createGoalSchema', () => {
  const schema = createGoalSchema(TODAY);

  it('accepts numbers and numeric strings and normalises them to exact decimal strings', () => {
    const r = schema.safeParse({ ...valid, targetAmount: '1500.50', currentFundedAmount: 0.07 });
    expect(r.success && r.data).toMatchObject({ targetAmount: '1500.50', currentFundedAmount: '0.07' });
  });

  it('defaults the funded amount to 0 and trims the name', () => {
    const { currentFundedAmount: _drop, ...rest } = valid;
    const r = schema.safeParse({ ...rest, goalName: '  Trip  ' });
    expect(r.success && r.data).toMatchObject({ currentFundedAmount: '0', goalName: 'Trip' });
  });

  it.each([
    ['zero target', { targetAmount: 0 }, 'targetAmount: Must be greater than 0'],
    ['negative target', { targetAmount: -5 }, 'targetAmount: Must be a non-negative amount with at most 2 decimal places'],
    ['3 decimals', { targetAmount: '10.123' }, 'targetAmount: Must be a non-negative amount with at most 2 decimal places'],
    ['exponent string', { targetAmount: '1e3' }, 'targetAmount: Must be a non-negative amount with at most 2 decimal places'],
    ['tiny exponent number', { targetAmount: 1e-7 }, 'targetAmount: Must be a non-negative amount with at most 2 decimal places'],
    ['huge number', { targetAmount: 1e21 }, 'targetAmount: Must be a non-negative amount with at most 2 decimal places'],
    ['text amount', { targetAmount: 'ten' }, 'targetAmount: Must be a non-negative amount with at most 2 decimal places'],
    ['null amount', { targetAmount: null }, 'targetAmount: Required'],
    ['negative funded', { currentFundedAmount: -1 }, 'currentFundedAmount: Must be a non-negative amount with at most 2 decimal places'],
    ['funded above target', { currentFundedAmount: 600000 }, 'currentFundedAmount: Cannot exceed the target amount'],
    ['date today', { targetDate: TODAY }, `targetDate: Must be after ${TODAY}`],
    ['date in the past', { targetDate: '2020-01-01' }, `targetDate: Must be after ${TODAY}`],
    ['date too far away', { targetDate: '2101-01-01' }, 'targetDate: Must be on or before 2100-12-31'],
    ['impossible date', { targetDate: '2030-02-30' }, 'targetDate: Must be a real date in YYYY-MM-DD format'],
    ['blank name', { goalName: '   ' }, 'goalName: Required'],
    ['121-char name', { goalName: 'x'.repeat(121) }, 'goalName: Must be at most 120 characters'],
    ['unknown type', { goalType: 'HOLIDAY' }, expect.stringContaining('goalType:')],
    ['unknown field (typo protection)', { targetamount: 5 }, 'targetamount: Unknown field: targetamount'],
  ])('rejects %s', (_label, change, expected) => {
    expect(messages(schema.safeParse({ ...valid, ...change }))).toEqual([expected]);
  });

  it('reports every missing field with "Required"', () => {
    expect(messages(schema.safeParse({}))).toEqual(
      expect.arrayContaining(['goalType: Required', 'goalName: Required', 'targetAmount: Required', 'targetDate: Required', 'priority: Required']),
    );
  });

  it.each([[null], [[]], ['text'], [42]])('rejects a body that is not an object (%j)', (body) => {
    expect(schema.safeParse(body).success).toBe(false);
  });
});

describe('patchGoalSchema', () => {
  const schema = patchGoalSchema(TODAY);

  it('accepts a single field', () => expect(schema.safeParse({ priority: 'LOW' }).success).toBe(true));
  it('rejects fields that cannot be edited', () => expect(schema.safeParse({ customerId: 'C0002' }).success).toBe(false));
  it('validates fields it is given', () => {
    expect(messages(schema.safeParse({ targetAmount: 0 }))).toEqual(['targetAmount: Must be greater than 0']);
    expect(messages(schema.safeParse({ targetDate: '2001-01-01' }))).toEqual([`targetDate: Must be after ${TODAY}`]);
  });
});
