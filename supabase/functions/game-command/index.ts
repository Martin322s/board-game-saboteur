// Supabase Edge Function (Deno): the single authoritative gameplay command endpoint.
// All logic lives in ../_shared/game (host-neutral, tested under Node); this file only wires
// Deno-specific pieces: env, the service-role client, JWT verification and secure randomness.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleGameHttp } from '../_shared/game/http.ts';
import { createRpcGameStore } from '../_shared/game/store.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey)
  throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');

// Service-role client: server-side only, never sent to browsers.
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const allowedOrigins = (
  Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const store = createRpcGameStore(async (fn, payload) => {
  const { data, error } = await admin.rpc(fn, { p: payload });
  if (error) throw new Error(`${fn}: ${error.code ?? ''} ${error.message}`);
  return data;
});

function generateSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); // 128-bit CSPRNG seed
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function authenticate(token: string): Promise<string | null> {
  const { data, error } = await admin.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

Deno.serve((req) =>
  handleGameHttp(req, {
    store,
    generateSeed,
    authenticate,
    allowedOrigins,
    log: (entry) => console.log(JSON.stringify(entry)),
  }),
);
