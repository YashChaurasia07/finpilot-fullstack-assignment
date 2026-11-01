import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { goals, goalType, priority } from '../db/schema';
import { AppError, fieldError } from '../lib/errors';
import { isoDate } from '../lib/params';
import { requireCustomer } from './customers';

export type GoalRow = typeof goals.$inferSelect;
export type GoalFlag = 'OVERDUE' | 'OVER_FUNDED' | 'COMPLETED';

/**
 * Funded % and highlight flags. Pure, so the rules are unit-tested with a pinned "today".
 *   OVERDUE      target date has passed and the goal is not fully funded
 *   OVER_FUNDED  funded more than the target (logically inconsistent; only reachable through imported data)
 *   COMPLETED    funded exactly the target
 */
export function goalView(goal: GoalRow, today: string) {
  const funded = Number(goal.currentFundedAmount);
  const target = Number(goal.targetAmount); // the table's CHECK guarantees target > 0
  const flags: GoalFlag[] = [];
  if (funded > target) flags.push('OVER_FUNDED');
  else if (funded === target) flags.push('COMPLETED');
  if (goal.targetDate < today && funded < target) flags.push('OVERDUE');
  return { ...goal, fundedPct: Math.round((funded / target) * 1000) / 10, flags };
}

/* ---------- input validation ---------- */
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const MAX_TARGET_DATE = '2100-12-31';

/**
 * Accepts 1500, 1500.5 or "1500.50" and normalises to an exact decimal string for NUMERIC.
 * Rejects negatives, 3+ decimals, exponent notation ("1e3"), NaN/Infinity and absurdly large values.
 */
const amount = (opts: { positive: boolean }) =>
  z.unknown().transform((value, ctx) => {
    const fail = (message: string) => {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    };
    const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : undefined;
    if (value === undefined || value === null || text === '') return fail('Required');
    if (text === undefined || !MONEY.test(text)) return fail('Must be a non-negative amount with at most 2 decimal places');
    if (opts.positive && Number(text) <= 0) return fail('Must be greater than 0');
    return text;
  });

const goalName = z.string().trim().min(1, 'Required').max(120, 'Must be at most 120 characters');

export const createGoalSchema = (today: string) =>
  z
    .strictObject({
      goalType: z.enum(goalType.enumValues),
      goalName,
      targetAmount: amount({ positive: true }),
      currentFundedAmount: amount({ positive: false }).default('0'),
      targetDate: isoDate({ after: today, max: MAX_TARGET_DATE }),
      priority: z.enum(priority.enumValues),
    })
    .superRefine((goal, ctx) => {
      if (Number(goal.currentFundedAmount) > Number(goal.targetAmount)) {
        ctx.addIssue({ code: 'custom', path: ['currentFundedAmount'], message: 'Cannot exceed the target amount' });
      }
    });

export const patchGoalSchema = (today: string) =>
  z
    .strictObject({
      goalType: z.enum(goalType.enumValues).optional(),
      goalName: goalName.optional(),
      targetAmount: amount({ positive: true }).optional(),
      currentFundedAmount: amount({ positive: false }).optional(),
      targetDate: isoDate({ after: today, max: MAX_TARGET_DATE }).optional(),
      priority: z.enum(priority.enumValues).optional(),
    });

export type CreateGoal = z.output<ReturnType<typeof createGoalSchema>>;
export type PatchGoal = z.output<ReturnType<typeof patchGoalSchema>>;

/* ---------- use cases ---------- */
export async function listGoals(customerId: string, today: string) {
  await requireCustomer(customerId);
  const rows = await db
    .select()
    .from(goals)
    .where(eq(goals.customerId, customerId))
    .orderBy(desc(goals.priority), goals.targetDate, goals.goalId); // HIGH first (enum order), then soonest
  return rows.map((row) => goalView(row, today));
}

export async function createGoal(customerId: string, input: CreateGoal, today: string) {
  await requireCustomer(customerId);
  const [row] = await db
    .insert(goals)
    .values({ customerId, ...input })
    .returning();
  return goalView(row, today);
}

export async function updateGoal(goalId: string, patch: PatchGoal, today: string) {
  if (!Object.values(patch).some((v) => v !== undefined)) throw fieldError('body', 'Provide at least one field to update');
  return db.transaction(async (tx) => {
    // Lock the row so two simultaneous edits cannot each pass validation and together break the rule.
    const [current] = await tx.select().from(goals).where(eq(goals.goalId, goalId)).for('update');
    if (!current) throw new AppError(404, 'NOT_FOUND', `Goal ${goalId} not found`);

    // Only re-check "funded <= target" when this edit touches either amount, so renaming an
    // already over-funded (imported) goal is still allowed.
    if (patch.targetAmount !== undefined || patch.currentFundedAmount !== undefined) {
      const target = Number(patch.targetAmount ?? current.targetAmount);
      const funded = Number(patch.currentFundedAmount ?? current.currentFundedAmount);
      if (funded > target) throw fieldError('currentFundedAmount', 'Cannot exceed the target amount');
    }

    const [row] = await tx
      .update(goals)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(eq(goals.goalId, goalId))
      .returning();
    return goalView(row, today);
  });
}
