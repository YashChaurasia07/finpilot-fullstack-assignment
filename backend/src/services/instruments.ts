import { db } from '../db/client';
import { instruments } from '../db/schema';

/** The whole security master is small (80 rows), so the filter dropdown just gets all of it. */
export const listInstruments = () =>
  db
    .select({
      instrumentId: instruments.instrumentId,
      symbol: instruments.symbol,
      instrumentName: instruments.instrumentName,
      assetClass: instruments.assetClass,
    })
    .from(instruments)
    .orderBy(instruments.symbol);
