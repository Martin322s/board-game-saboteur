import { QueryClient } from '@tanstack/react-query';

/**
 * Server state lives in TanStack Query. Freshness will be driven by realtime invalidation
 * (ARCHITECTURE §7), so polling defaults stay conservative.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
    },
  });
}
