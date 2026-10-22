/**
 * Public (browser-safe) configuration. Only VITE_* variables reach the bundle, so nothing here
 * may ever be secret. The service-role key must never be configured for the frontend.
 */
export interface PublicEnv {
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
}

export type PublicEnvResult =
  | { readonly ok: true; readonly value: PublicEnv }
  | { readonly ok: false; readonly missing: readonly string[] };

type RawEnv = Readonly<Record<string, string | boolean | undefined>>;

export function readPublicEnv(raw: RawEnv = import.meta.env): PublicEnvResult {
  const url = typeof raw.VITE_SUPABASE_URL === 'string' ? raw.VITE_SUPABASE_URL.trim() : '';
  const key =
    typeof raw.VITE_SUPABASE_PUBLISHABLE_KEY === 'string'
      ? raw.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
      : '';

  const missing: string[] = [];
  if (!isHttpUrl(url)) missing.push('VITE_SUPABASE_URL');
  if (!key) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, value: { supabaseUrl: url, supabasePublishableKey: key } };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
