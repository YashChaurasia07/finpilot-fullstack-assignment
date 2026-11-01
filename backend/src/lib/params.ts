import { z } from 'zod';
import { isRealDate } from './dates';
import { AppError } from './errors';

const ID = /^[A-Za-z0-9_-]{1,12}$/;

/** Path IDs: a malformed ID cannot exist, so it is simply "not found". */
export function parseId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new AppError(404, 'NOT_FOUND', `${label} not found`);
  return value;
}

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

/** Optional query parameter where an empty value counts as "not provided". */
export const optional = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToUndefined, schema.optional());

/** Whole-number query parameter. Rejects "abc", "1e3", "-1", "0x10" and repeated parameters. */
export const intParam = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d{1,9}$/, 'Must be a whole number')
    .transform(Number)
    .pipe(z.number().min(min, `Must be at least ${min}`).max(max, `Must be at most ${max}`));

export const pageParams = {
  page: z.preprocess(emptyToUndefined, intParam(1, 1_000_000).default(1)),
  pageSize: z.preprocess(emptyToUndefined, intParam(1, 100).default(20)),
};

/** A real YYYY-MM-DD date, optionally bounded. Reports exactly one message per failure. */
export const isoDate = (bounds: { after?: string; max?: string } = {}) =>
  z.string().transform((value, ctx) => {
    const fail = (message: string) => {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    };
    if (!isRealDate(value)) return fail('Must be a real date in YYYY-MM-DD format');
    if (bounds.after && value <= bounds.after) return fail(`Must be after ${bounds.after}`);
    if (bounds.max && value > bounds.max) return fail(`Must be on or before ${bounds.max}`);
    return value;
  });
