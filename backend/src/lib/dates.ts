const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for real calendar dates in YYYY-MM-DD form (rejects 2026-02-30, 2026-13-01, "tomorrow"). */
export function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Today as YYYY-MM-DD (server clock, UTC). Pure functions take it as a parameter so tests can pin it. */
export const today = (): string => new Date().toISOString().slice(0, 10);
