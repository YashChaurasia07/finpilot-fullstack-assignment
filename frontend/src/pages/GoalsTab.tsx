import { useState } from 'react';
import { useGoals, useSaveGoal } from '../api/hooks';
import type { Goal, GoalInput } from '../api/types';
import { GoalCard } from '../components/GoalCard';
import { GoalForm } from '../components/GoalForm';
import { Modal } from '../components/Modal';
import { EmptyState, QueryState } from '../components/QueryState';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useCustomerContext } from './customerContext';

export function GoalsTab() {
  useDocumentTitle('Goals');
  const { customer } = useCustomerContext();
  const query = useGoals(customer.customerId);
  const save = useSaveGoal(customer.customerId);
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [notice, setNotice] = useState('');

  const close = () => {
    setEditing(null);
    save.reset(); // a stale error must not greet the next person who opens the form
  };

  function submit(values: Partial<GoalInput>) {
    const goalId = editing && editing !== 'new' ? editing.goalId : undefined;
    save.mutate(
      { goalId, values },
      {
        onSuccess: (goal) => {
          setNotice(goalId ? `“${goal.goalName}” was updated.` : `“${goal.goalName}” was added.`);
          close();
        },
      },
    );
  }

  const addButton = (
    <button type="button" className="btn btn-primary" onClick={() => { setNotice(''); setEditing('new'); }}>
      Add goal
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Financial goals</h2>
        {addButton}
      </div>
      <p role="status" aria-live="polite" className={notice ? 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900' : 'sr-only'}>
        {notice}
      </p>

      <QueryState query={query} isEmpty={(goals) => goals.length === 0} loadingLabel="Loading goals…" empty={<EmptyState title="No goals yet" hint="Set up the first goal for this customer." action={addButton} />}>
        {(goals) => (
          <div className="grid gap-4 md:grid-cols-2">
            {goals.map((g) => (
              <GoalCard key={g.goalId} goal={g} onEdit={(goal) => { setNotice(''); setEditing(goal); }} />
            ))}
          </div>
        )}
      </QueryState>

      <Modal open={editing !== null} title={editing && editing !== 'new' ? 'Edit goal' : 'Add goal'} onClose={close}>
        <GoalForm goal={editing && editing !== 'new' ? editing : undefined} saving={save.isPending} error={save.error} onSubmit={submit} onCancel={close} />
      </Modal>
    </div>
  );
}
