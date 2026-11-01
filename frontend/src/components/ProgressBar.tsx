/** A bar capped at 100% visually; the real number (which may exceed 100) stays in the label. */
export function ProgressBar({ value, label, tone = 'bg-indigo-600' }: { value: number; label: string; tone?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)} className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
