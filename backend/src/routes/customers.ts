import { Router } from 'express';
import { z } from 'zod';
import { txStatus, txType } from '../db/schema';
import { today } from '../lib/dates';
import { created, ok, pageMeta } from '../lib/respond';
import { isoDate, optional, pageParams, parseId } from '../lib/params';
import { getCustomerProfile, searchCustomers } from '../services/customers';
import { createGoal, createGoalSchema, listGoals } from '../services/goals';
import { getPortfolio } from '../services/portfolio';
import { listTransactions } from '../services/transactions';

const listQuery = z.object({
  q: optional(z.string().trim().max(100, 'Must be at most 100 characters')),
  ...pageParams,
});

const idFilter = z.string().regex(/^[A-Za-z0-9_-]{1,12}$/, 'Not a valid ID');

const transactionQuery = z
  .object({
    ...pageParams,
    from: optional(isoDate()),
    to: optional(isoDate()),
    accountId: optional(idFilter),
    instrumentId: optional(idFilter),
    type: optional(z.enum(txType.enumValues)),
    status: optional(z.enum(txStatus.enumValues)),
    sortBy: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['tradeDate', 'amount']).default('tradeDate')),
    order: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['asc', 'desc']).default('desc')),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { path: ['to'], message: 'Must be on or after "from"' });

export const customerRoutes = Router();

customerRoutes.get('/', async (req, res) => {
  const { q, page, pageSize } = listQuery.parse(req.query);
  const { rows, total } = await searchCustomers({ q, page, pageSize });
  ok(res, rows, pageMeta(page, pageSize, total));
});

customerRoutes.get('/:id', async (req, res) => {
  ok(res, await getCustomerProfile(parseId(req.params.id, 'Customer')));
});

customerRoutes.get('/:id/portfolio', async (req, res) => {
  ok(res, await getPortfolio(parseId(req.params.id, 'Customer')));
});

customerRoutes.get('/:id/transactions', async (req, res) => {
  const id = parseId(req.params.id, 'Customer');
  const query = transactionQuery.parse(req.query);
  const { rows, total } = await listTransactions(id, query);
  ok(res, rows, pageMeta(query.page, query.pageSize, total));
});

customerRoutes.get('/:id/goals', async (req, res) => {
  ok(res, await listGoals(parseId(req.params.id, 'Customer'), today()));
});

customerRoutes.post('/:id/goals', async (req, res) => {
  const id = parseId(req.params.id, 'Customer');
  const now = today();
  const goal = await createGoal(id, createGoalSchema(now).parse(req.body ?? {}), now);
  created(res, goal, `/api/v1/goals/${goal.goalId}`);
});
