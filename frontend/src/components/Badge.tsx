import type { ReactNode } from 'react';
import type { Tone } from '../lib/tones';

const STYLES: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-300',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  amber: 'bg-amber-50 text-amber-900 ring-amber-300',
  rose: 'bg-rose-50 text-rose-800 ring-rose-300',
  indigo: 'bg-indigo-50 text-indigo-800 ring-indigo-300',
  sky: 'bg-sky-50 text-sky-900 ring-sky-300',
};

export function Badge({ tone = 'slate', title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[tone]}`}>
      {children}
    </span>
  );
}
