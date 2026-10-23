import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { readPublicEnv } from '../lib/env.ts';
import { createSupabaseServices } from '../lib/services/supabaseServices.ts';
import type { Services } from '../lib/services/types.ts';
import { getSupabaseClient } from '../lib/supabase/client.ts';
import { AppProviders } from './AppProviders.tsx';
import { createQueryClient } from './queryClient.ts';
import { routes } from './routes.tsx';

function createServices(): Services | null {
  const env = readPublicEnv();
  // Without public config the app still renders; multiplayer pages explain what is missing.
  return env.ok ? createSupabaseServices(getSupabaseClient(env.value)) : null;
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [services] = useState(createServices);
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <AppProviders services={services} queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
