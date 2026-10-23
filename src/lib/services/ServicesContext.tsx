import { createContext, useContext, type ReactNode } from 'react';
import { AppError } from '../errors/appError.ts';
import type { Services } from './types.ts';

/** null when the public Supabase configuration is missing (see src/lib/env.ts). */
const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services: Services | null;
  children: ReactNode;
}) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useOptionalServices(): Services | null {
  return useContext(ServicesContext);
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new AppError('CONFIG_ERROR');
  return services;
}
