const DASH = '—';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrSigned = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, signDisplay: 'exceptZero' });
const plain = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toNumber = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** The API sends money as exact decimal strings; they are converted to numbers only here, for display. */
export function formatINR(value: string | number | null | undefined, opts: { signed?: boolean } = {}): string {
  const n = toNumber(value);
  if (n === null) return DASH;
  return (opts.signed ? inrSigned : inr).format(n);
}

export function formatNumber(value: string | number | null | undefined): string {
  const n = toNumber(value);
  return n === null ? DASH : plain.format(n);
}

export function formatPct(value: string | number | null | undefined, opts: { signed?: boolean } = {}): string {
  const n = toNumber(value);
  if (n === null) return DASH;
  const text = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 2, signDisplay: opts.signed ? 'exceptZero' : 'auto' }).format(n);
  return `${text}%`;
}

/** "2026-09-18" -> "18 Sep 2026". Built from the text itself (no Date, no locale), so it never shifts with timezone or ICU data. */
export function formatDate(iso: string | null | undefined): string {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!match) return DASH;
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  return monthName && Number(day) >= 1 && Number(day) <= 31 ? `${Number(day)} ${monthName} ${year}` : DASH;
}

export function formatDateTime(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : DASH;
}

export const formatBytes = (bytes: number): string => (bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`);

/** The viewer's local calendar date as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from one YYYY-MM-DD to another (negative if `to` is earlier). UTC maths, so DST never skews it. */
export function daysBetween(fromIso: string, toIso: string): number {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  return Math.round((day(toIso) - day(fromIso)) / 86_400_000);
}

/** The day after the viewer's today, as YYYY-MM-DD (the earliest allowed goal date). */
export function tomorrowISO(now: Date = new Date()): string {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  return todayISO(next);
}

/** For P&L numbers: green up, red down, neutral at zero. Used together with a sign, never colour alone. */
export const pnlClass = (value: string | number | null | undefined): string => {
  const n = toNumber(value);
  return n === null || n === 0 ? 'text-slate-700' : n > 0 ? 'text-emerald-700' : 'text-rose-700';
};
