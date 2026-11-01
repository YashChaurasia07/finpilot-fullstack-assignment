import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { Goal } from '../api/types';
import { GoalForm } from './GoalForm';

const goal: Goal = {
  goalId: 'G00001',
  customerId: 'C0001',
  goalType: 'EDUCATION',
  goalName: 'College fund',
  targetAmount: '500000.00',
  currentFundedAmount: '25000.00',
  targetDate: '2020-01-01', // already past: an overdue goal
  priority: 'HIGH',
  fundedPct: 5,
  flags: ['OVERDUE'],
};

const setup = (props: Partial<React.ComponentProps<typeof GoalForm>> = {}) => {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(<GoalForm saving={false} error={null} onSubmit={onSubmit} onCancel={onCancel} {...props} />);
  return { onSubmit, onCancel, user: userEvent.setup() };
};

describe('GoalForm (create)', () => {
  it('has a label for every field and submits the typed values', async () => {
    const { onSubmit, user } = setup();
    await user.type(screen.getByLabelText('Goal name'), 'Trip to Japan');
    await user.selectOptions(screen.getByLabelText('Goal type'), 'TRAVEL');
    await user.selectOptions(screen.getByLabelText('Priority'), 'HIGH');
    await user.type(screen.getByLabelText('Target amount (₹)'), '300000');
    await user.clear(screen.getByLabelText('Funded so far (₹)'));
    await user.type(screen.getByLabelText('Funded so far (₹)'), '1500.5');
    await user.type(screen.getByLabelText('Target date'), '2031-04-01');
    await user.click(screen.getByRole('button', { name: 'Add goal' }));
    expect(onSubmit).toHaveBeenCalledWith({ goalName: 'Trip to Japan', goalType: 'TRAVEL', priority: 'HIGH', targetAmount: '300000', currentFundedAmount: '1500.5', targetDate: '2031-04-01' });
  });

  it('does not submit while required fields are empty (browser validation)', async () => {
    const { onSubmit, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Add goal' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows server field errors next to the right input and marks it invalid', () => {
    const error = new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', [
      { field: 'currentFundedAmount', message: 'Cannot exceed the target amount' },
      { field: 'targetDate', message: 'Must be after 2026-10-31' },
    ]);
    setup({ error });
    const funded = screen.getByLabelText('Funded so far (₹)');
    expect(funded).toHaveAttribute('aria-invalid', 'true');
    expect(funded).toHaveAccessibleDescription('Cannot exceed the target amount');
    expect(screen.getByLabelText('Target date')).toHaveAccessibleDescription('Must be after 2026-10-31');
    expect(screen.getByLabelText('Goal name')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // field errors are not repeated as a general error
  });

  it('shows a general message for problems that are not about a field', () => {
    setup({ error: new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.') });
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach the server');
  });

  it('disables both buttons while saving, and Cancel calls onCancel', async () => {
    const { user, onCancel } = setup({ saving: true });
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(onCancel).not.toHaveBeenCalled();
    void user;
  });
});

describe('GoalForm (edit)', () => {
  it('starts with the goal’s values', () => {
    setup({ goal });
    expect(screen.getByLabelText('Goal name')).toHaveValue('College fund');
    expect(screen.getByLabelText('Priority')).toHaveValue('HIGH');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('sends ONLY the changed fields, so an overdue goal can be renamed without touching its past date', async () => {
    const { onSubmit, user } = setup({ goal });
    await user.clear(screen.getByLabelText('Goal name'));
    await user.type(screen.getByLabelText('Goal name'), 'University fund');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ goalName: 'University fund' });
  });

  it('does not block saving because of a past target date it is not changing', async () => {
    setup({ goal });
    expect(screen.getByLabelText('Target date')).not.toHaveAttribute('min');
  });

  it('closes without calling the API when nothing changed', async () => {
    const { onSubmit, onCancel, user } = setup({ goal });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
