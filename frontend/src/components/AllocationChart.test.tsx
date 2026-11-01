import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Portfolio } from '../api/types';
import { AllocationChart } from './AllocationChart';

const slices: Portfolio['allocation'] = [
  { assetClass: 'EQUITY', marketValue: '201193.28', weightPct: '76.47' },
  { assetClass: 'MUTUAL_FUND', marketValue: '57550.81', weightPct: '21.88' },
  { assetClass: 'BOND', marketValue: '4344.40', weightPct: '1.65' },
];

describe('AllocationChart accessibility', () => {
  it('describes the whole chart to screen readers', () => {
    render(<AllocationChart slices={slices} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Asset allocation: Equity 76.47%, Mutual fund 21.88%, Bond 1.65%.');
  });

  it('provides the same data as a real table (the chart is never the only source)', () => {
    render(<AllocationChart slices={slices} />);
    const table = screen.getByRole('table', { name: 'Allocation by asset class' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4); // header + 3 classes
    expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('Equity');
    expect(rows[1]).toHaveTextContent('₹2,01,193.28');
    expect(rows[1]).toHaveTextContent('76.47%');
  });
});
