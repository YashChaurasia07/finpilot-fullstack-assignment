import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { TransactionFilters } from '../lib/params';
import { ApiError, request } from './client';
import type { CustomerProfile, CustomerSummary, Goal, GoalInput, ImportResult, InstrumentOption, Portfolio, Transaction, User } from './types';

/* ---------- session ---------- */
/**
 * Drop every cached response except the session itself, so one user's data is never shown to the next.
 * (queryClient.clear() would also detach the live ['me'] subscription, leaving the app stuck on the sign-in page.)
 */
const forgetCachedData = (qc: QueryClient) => qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });

/** `null` means "not signed in" (a normal state), not an error. */
export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: async ({ signal }) => {
      try {
        return (await request<{ user: User }>('/auth/me', { signal })).data.user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (credentials: { email: string; password: string }) => request<{ user: User }>('/auth/login', { json: credentials }).then((r) => r.data.user),
    onSuccess: (user) => {
      forgetCachedData(qc);
      qc.setQueryData(['me'], user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      forgetCachedData(qc);
      qc.setQueryData(['me'], null);
    },
  });
}

/* ---------- reads ---------- */
export const useCustomers = (params: { q: string; page: number; pageSize: number }) =>
  useQuery({
    queryKey: ['customers', params],
    queryFn: ({ signal }) => request<CustomerSummary[]>('/customers', { query: params, signal }),
    placeholderData: keepPreviousData, // keep showing the old page while the next one loads
  });

export const useCustomer = (customerId: string) =>
  useQuery({
    queryKey: ['customer', customerId],
    queryFn: ({ signal }) => request<CustomerProfile>(`/customers/${encodeURIComponent(customerId)}`, { signal }).then((r) => r.data),
  });

export const usePortfolio = (customerId: string) =>
  useQuery({
    queryKey: ['portfolio', customerId],
    queryFn: ({ signal }) => request<Portfolio>(`/customers/${encodeURIComponent(customerId)}/portfolio`, { signal }).then((r) => r.data),
  });

export const useTransactions = (customerId: string, filters: TransactionFilters, enabled = true) =>
  useQuery({
    queryKey: ['transactions', customerId, filters],
    queryFn: ({ signal }) => request<Transaction[]>(`/customers/${encodeURIComponent(customerId)}/transactions`, { query: { ...filters }, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useGoals = (customerId: string) =>
  useQuery({
    queryKey: ['goals', customerId],
    queryFn: ({ signal }) => request<Goal[]>(`/customers/${encodeURIComponent(customerId)}/goals`, { signal }).then((r) => r.data),
  });

export const useInstruments = () =>
  useQuery({
    queryKey: ['instruments'],
    queryFn: ({ signal }) => request<InstrumentOption[]>('/instruments', { signal }).then((r) => r.data),
    staleTime: Infinity, // reference data
  });

/* ---------- writes ---------- */
export function useSaveGoal(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    /** `goalId` present = edit (PATCH only the changed fields); absent = create. */
    mutationFn: ({ goalId, values }: { goalId?: string; values: Partial<GoalInput> }) =>
      goalId
        ? request<Goal>(`/goals/${encodeURIComponent(goalId)}`, { method: 'PATCH', json: values }).then((r) => r.data)
        : request<Goal>(`/customers/${encodeURIComponent(customerId)}/goals`, { json: values }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals', customerId] }),
  });
}

export function useImportTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return request<ImportResult>('/admin/imports/transactions', { body: form }).then((r) => r.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }), // new ledger rows may now be visible
  });
}
