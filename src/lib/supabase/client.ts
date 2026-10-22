import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PublicEnv } from '../env.ts';

/**
 * The one place a Supabase client is created. Uses only the publishable (anon) key; all
 * authorization is enforced by the database (RLS, grants, SECURITY DEFINER RPCs).
 */
let client: SupabaseClient | null = null;

export function getSupabaseClient(env: PublicEnv): SupabaseClient {
  client ??= createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      // The anonymous session IS the player identity (ARCHITECTURE §9.1): keep it across
      // refreshes and tabs of this browser profile.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'tunnels.auth',
    },
  });
  return client;
}
