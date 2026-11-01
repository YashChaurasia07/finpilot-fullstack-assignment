import type { UseQueryResult } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { QueryState } from './QueryState';

const query = (over: Partial<UseQueryResult<string[]>>) =>
  ({ isPending: false, isError: false, isFetching: false, data: ['a'], error: null, refetch: vi.fn(), ...over }) as unknown as UseQueryResult<string[]>;

describe('QueryState', () => {
  it('shows a loading status while pending', () => {
    render(<QueryState query={query({ isPending: true, data: undefined })} loadingLabel="Loading things…">{() => <p>data</p>}</QueryState>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading things…');
    expect(screen.queryByText('data')).not.toBeInTheDocument();
  });

  it('shows the data when it has some', () => {
    render(<QueryState query={query({ data: ['x', 'y'] })}>{(d) => <p>{d.join(',')}</p>}</QueryState>);
    expect(screen.getByText('x,y')).toBeInTheDocument();
  });

  it('shows the empty state instead of the children when isEmpty says so', () => {
    render(
      <QueryState query={query({ data: [] })} isEmpty={(d) => d.length === 0} empty={<p>Nothing here</p>}>
        {() => <p>data</p>}
      </QueryState>,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('shows an alert with the API message, a support reference, and a working retry for a temporary failure', async () => {
    const refetch = vi.fn();
    const error = new ApiError(503, 'SERVICE_UNAVAILABLE', 'The database is unreachable.', undefined, 'req-42');
    render(<QueryState query={query({ isError: true, error, data: undefined, refetch })}>{() => <p>data</p>}</QueryState>);
    expect(screen.getByRole('alert')).toHaveTextContent('Server problem');
    expect(screen.getByRole('alert')).toHaveTextContent('The database is unreachable.');
    expect(screen.getByRole('alert')).toHaveTextContent('req-42');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('offers no retry for a permanent error such as 404', () => {
    const error = new ApiError(404, 'NOT_FOUND', 'Customer C9 not found');
    render(<QueryState query={query({ isError: true, error, data: undefined })}>{() => <p>data</p>}</QueryState>);
    expect(screen.getByRole('alert')).toHaveTextContent('Not found');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('describes a lost connection helpfully', () => {
    const error = new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
    render(<QueryState query={query({ isError: true, error, data: undefined })}>{() => <p>data</p>}</QueryState>);
    expect(screen.getByRole('alert')).toHaveTextContent('Connection problem');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('keeps showing the previous data (marked busy) while the next page loads', () => {
    render(<QueryState query={query({ isFetching: true, data: ['old'] })}>{(d) => <p>{d[0]}</p>}</QueryState>);
    expect(screen.getByText('old').parentElement).toHaveAttribute('aria-busy', 'true');
  });

  it('copes with a thrown value that is not an ApiError', () => {
    render(<QueryState query={query({ isError: true, error: new Error('boom'), data: undefined })}>{() => <p>data</p>}</QueryState>);
    expect(screen.getByRole('alert')).toHaveTextContent('unexpected error');
    expect(screen.getByRole('alert')).not.toHaveTextContent('boom');
  });
});
