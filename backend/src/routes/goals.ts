import { Router } from 'express';
import { today } from '../lib/dates';
import { ok } from '../lib/respond';
import { parseId } from '../lib/params';
import { patchGoalSchema, updateGoal } from '../services/goals';

export const goalRoutes = Router();

goalRoutes.patch('/:goalId', async (req, res) => {
  const goalId = parseId(req.params.goalId, 'Goal');
  const now = today();
  ok(res, await updateGoal(goalId, patchGoalSchema(now).parse(req.body ?? {}), now));
});
