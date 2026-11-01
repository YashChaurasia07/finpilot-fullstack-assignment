import type { Goal } from '../api/types';
import { daysBetween, formatDate, formatINR, formatPct, todayISO } from '../lib/format';
import { humanize } from '../lib/options';
import { FLAG_LABEL, flagTone, priorityTone } from '../lib/tones';
import { Badge } from './Badge';
import { ProgressBar } from './ProgressBar';

export function GoalCard({ goal, onEdit }: { goal: Goal; onEdit?: (goal: Goal) => void }) {
  const overdueDays = goal.flags.includes('OVERDUE') ? daysBetween(goal.targetDate, todayISO()) : 0;
  const barTone = goal.flags.includes('OVERDUE') ? 'bg-rose-600' : goal.flags.includes('OVER_FUNDED') ? 'bg-amber-500' : goal.flags.includes('COMPLETED') ? 'bg-emerald-600' : 'bg-indigo-600';
  return (
    <article className="card p-4" aria-label={goal.goalName}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium" title={goal.goalName}>
            {goal.goalName}
          </h3>
          <p className="text-sm text-slate-600">{humanize(goal.goalType)}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Badge tone={priorityTone(goal.priority)}>{humanize(goal.priority)} priority</Badge>
          {goal.flags.map((flag) => (
            <Badge key={flag} tone={flagTone(flag)}>
              {FLAG_LABEL[flag]}
            </Badge>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-baseline justify-between text-sm">
          <span className="font-medium tabular-nums">{formatPct(goal.fundedPct)} funded</span>
          <span className="tabular-nums text-slate-600">
            {formatINR(goal.currentFundedAmount)} of {formatINR(goal.targetAmount)}
          </span>
        </div>
        <ProgressBar value={goal.fundedPct} label={`${goal.goalName} is ${formatPct(goal.fundedPct)} funded`} tone={barTone} />
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className={overdueDays > 0 ? 'font-medium text-rose-700' : 'text-slate-600'}>
          {overdueDays > 0 ? `Target date ${formatDate(goal.targetDate)} (${overdueDays} ${overdueDays === 1 ? 'day' : 'days'} overdue)` : `Target date ${formatDate(goal.targetDate)}`}
        </span>
        {onEdit && (
          <button type="button" className="btn btn-secondary py-1" onClick={() => onEdit(goal)} aria-label={`Edit ${goal.goalName}`}>
            Edit
          </button>
        )}
      </div>
    </article>
  );
}
