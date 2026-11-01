import type { ReactNode } from 'react';

export function StatCard({ label, value, hint, valueClassName = '' }: { label: string; value: ReactNode; hint?: ReactNode; valueClassName?: string }) {
  return (
    <div className="card min-w-0 p-4">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className={`mt-1 break-words text-xl font-semibold tabular-nums sm:text-2xl ${valueClassName}`}>{value}</p>
      {hint && <p className="mt-1 text-sm text-slate-600">{hint}</p>}
    </div>
  );
}
