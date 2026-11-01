import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

/** Retry only what can succeed on a second try: network blips and 5xx. A 400/401/403/404 is final. */
export const shouldRetry = (failureCount: number, error: unknown): boolean =>
  failureCount < 2 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500);

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: shouldRetry },
    },
  });
