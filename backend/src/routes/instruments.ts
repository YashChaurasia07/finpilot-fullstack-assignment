import { Router } from 'express';
import { ok } from '../lib/respond';
import { listInstruments } from '../services/instruments';

export const instrumentRoutes = Router();

instrumentRoutes.get('/', async (_req, res) => {
  ok(res, await listInstruments());
});
