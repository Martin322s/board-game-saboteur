import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AuthProvider } from '../features/session/AuthProvider.tsx';
import { ServicesProvider } from '../lib/services/ServicesContext.tsx';
import type { Services } from '../lib/services/types.ts';

/** Shared provider stack for the app and for component tests (which inject fake services). */
export function AppProviders({
  services,
  queryClient,
  children,
}: {
  services: Services | null;
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ServicesProvider services={services}>
        <AuthProvider gateway={services?.auth ?? null}>{children}</AuthProvider>
      </ServicesProvider>
    </QueryClientProvider>
  );
}
