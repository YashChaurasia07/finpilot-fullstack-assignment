import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import type { Goal, GoalInput } from '../api/types';
import { tomorrowISO } from '../lib/format';
import { GOAL_TYPES, PRIORITIES, humanize } from '../lib/options';

interface Props {
  /** Present = edit mode (only the changed fields are sent); absent = create. */
  goal?: Goal;
  saving: boolean;
  /** The last save error. 400s put their messages next to the matching inputs. */
  error: unknown;
  onSubmit: (values: Partial<GoalInput>) => void;
  onCancel: () => void;
}

const BLANK: GoalInput = { goalName: '', goalType: 'RETIREMENT', targetAmount: '', currentFundedAmount: '0', targetDate: '', priority: 'MEDIUM' };

export function GoalForm({ goal, saving, error, onSubmit, onCancel }: Props) {
  const formId = useId();
  const initial: GoalInput = goal
    ? { goalName: goal.goalName, goalType: goal.goalType, targetAmount: goal.targetAmount, currentFundedAmount: goal.currentFundedAmount, targetDate: goal.targetDate, priority: goal.priority }
    : BLANK;
  const [values, setValues] = useState<GoalInput>(initial);
  const set = <K extends keyof GoalInput>(key: K, value: GoalInput[K]) => setValues((v) => ({ ...v, [key]: value }));

  const apiError = error instanceof ApiError ? error : null;
  const fieldMessages = new Map(apiError?.fieldErrors.map((e) => [e.field, e.message]));
  // Anything that is not about a specific input (network, 403, 404...) is shown once, above the buttons.
  const generalError = error && fieldMessages.size === 0 ? (apiError?.message ?? 'Something went wrong. Please try again.') : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!goal) return onSubmit(values);
    const changed = (Object.keys(values) as (keyof GoalInput)[]).filter((k) => values[k] !== initial[k]);
    if (changed.length === 0) return onCancel(); // nothing to save
    onSubmit(Object.fromEntries(changed.map((k) => [k, values[k]])));
  }

  const field = (name: keyof GoalInput, label: string, input: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode) => {
    const id = `${formId}-${name}`;
    const message = fieldMessages.get(name);
    return (
      <div>
        <label htmlFor={id} className="label">
          {label}
        </label>
        {input({ id, 'aria-invalid': Boolean(message), 'aria-describedby': message ? `${id}-error` : undefined })}
        {message && (
          <p id={`${id}-error`} className="mt-1 text-sm text-rose-700">
            {message}
          </p>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {field('goalName', 'Goal name', (p) => (
        <input {...p} className="input" required maxLength={120} autoFocus value={values.goalName} onChange={(e) => set('goalName', e.target.value)} />
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        {field('goalType', 'Goal type', (p) => (
          <select {...p} className="input" value={values.goalType} onChange={(e) => set('goalType', e.target.value as GoalInput['goalType'])}>
            {GOAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
        ))}
        {field('priority', 'Priority', (p) => (
          <select {...p} className="input" value={values.priority} onChange={(e) => set('priority', e.target.value as GoalInput['priority'])}>
            {PRIORITIES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('targetAmount', 'Target amount (₹)', (p) => (
          <input {...p} className="input" type="number" inputMode="decimal" step="0.01" min="0.01" required value={values.targetAmount} onChange={(e) => set('targetAmount', e.target.value)} />
        ))}
        {field('currentFundedAmount', 'Funded so far (₹)', (p) => (
          <input {...p} className="input" type="number" inputMode="decimal" step="0.01" min="0" required value={values.currentFundedAmount} onChange={(e) => set('currentFundedAmount', e.target.value)} />
        ))}
      </div>
      {field('targetDate', 'Target date', (p) => (
        <input {...p} className="input" type="date" required min={goal ? undefined : tomorrowISO()} value={values.targetDate} onChange={(e) => set('targetDate', e.target.value)} />
      ))}

      {generalError && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {generalError}
        </p>
      )}
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : goal ? 'Save changes' : 'Add goal'}
        </button>
      </div>
    </form>
  );
}
