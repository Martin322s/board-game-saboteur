#!/usr/bin/env node
/**
 * Hosted smoke test using ONLY public configuration (URL + publishable key). Safe to run from CI
 * or a workstation. It never needs or prints privileged credentials.
 *
 *   SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... [ALLOWED_ORIGIN=https://...] node scripts/smoke-hosted.mjs
 *
 * Checks:
 *  1. Every lobby/game RPC exists in the Data API (no PGRST202) and is NOT executable without a
 *     session (anon role → permission denied), retrying briefly for PostgREST's schema cache.
 *  2. Trusted persistence RPCs are not executable by a signed-in (anonymous) player.
 *  3. game-command in the real Edge runtime: rejects missing auth, rejects an outdated rules
 *     version (CLIENT_OUTDATED), rejects malformed input (INVALID_REQUEST), and a well-formed
 *     command reaches the authoritative pipeline (NOT_ROOM_MEMBER for a random room).
 *  4. CORS: the allowed origin is echoed; an unknown origin is not.
 * Side effect: creates ONE anonymous auth user (as any visitor would).
 */
import { readFileSync } from 'node:fs';

const url = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
const origin = process.env.ALLOWED_ORIGIN ?? '';
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required');
  process.exit(2);
}
const rulesVersion = readFileSync(
  new URL('../src/domain/version.ts', import.meta.url),
  'utf8',
).match(/RULES_VERSION = (\d+)/)?.[1];

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const zero = '00000000-0000-4000-8000-000000000000';

async function rpc(fn, args, token) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, code: body?.code, body };
}

// 1. Client RPCs exist and are closed to the anon role --------------------------------------
const clientRpcs = {
  create_room: { p_display_name: 'Проба', p_capacity: 4 },
  join_room: { p_code: 'ABC234', p_display_name: 'Проба' },
  leave_room: { p_room_id: zero },
  set_ready: { p_room_id: zero, p_ready: true },
  heartbeat: { p_room_id: zero },
  claim_host: { p_room_id: zero },
  update_room_settings: { p_room_id: zero, p_capacity: 4 },
  kick_player: { p_room_id: zero, p_player_id: zero },
  get_room_snapshot: { p_code: 'ABC234' },
  get_my_active_room: {},
  get_game_snapshot: { p_room_id: zero },
  get_my_game_state: { p_room_id: zero },
  reset_room: { p_room_id: zero },
};
// Allow PostgREST's schema cache to catch up once (right after `db push`), not per function.
for (
  let i = 0;
  i < 6 && (await rpc('create_room', clientRpcs.create_room)).code === 'PGRST202';
  i++
) {
  await sleep(5_000);
}
for (const [fn, args] of Object.entries(clientRpcs)) {
  const result = await rpc(fn, args);
  check(
    result.code !== 'PGRST202',
    `rpc ${fn} exists`,
    `HTTP ${result.status} ${result.code ?? ''}`,
  );
  check(result.status === 401 || result.code === '42501', `rpc ${fn} denied without a session`);
}

// 2. Anonymous session; trusted functions are closed to players -----------------------------
const signup = await fetch(`${url}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: {} }),
});
const session = await signup.json().catch(() => ({}));
const token = session.access_token;
check(signup.ok && !!token, 'anonymous sign-in works', `HTTP ${signup.status}`);

if (token) {
  const mine = await rpc('get_my_active_room', {}, token);
  check(mine.status === 200 && mine.body?.ok === true, 'signed-in player can call lobby RPCs');
  for (const fn of [
    'game_server_context',
    'game_persist_start',
    'game_persist_transition',
    'game_persist_next_round',
    'game_persist_leave_ended',
  ]) {
    const r = await rpc(fn, { p: {} }, token);
    check(
      r.code === '42501' || r.status === 401 || r.status === 403,
      `trusted ${fn} denied to players`,
      `HTTP ${r.status} ${r.code ?? ''}`,
    );
  }
}

// 3. game-command in the real Edge runtime --------------------------------------------------
const fnUrl = `${url}/functions/v1/game-command`;
const command = (headers, body) =>
  fetch(fnUrl, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const valid = { roomId: zero, commandId: crypto.randomUUID(), command: { type: 'LEAVE' } };

const noAuth = await command({ 'x-rules-version': rulesVersion }, valid);
check(
  noAuth.status === 401,
  'game-command rejects requests without a user session',
  `HTTP ${noAuth.status}`,
);

if (token) {
  const auth = { Authorization: `Bearer ${token}` };
  const outdated = await command({ ...auth, 'x-rules-version': '0' }, valid);
  const outdatedBody = await outdated.json().catch(() => ({}));
  check(
    outdatedBody.error === 'CLIENT_OUTDATED',
    'outdated rules version → CLIENT_OUTDATED',
    `HTTP ${outdated.status} ${outdatedBody.error ?? ''}`,
  );

  const malformed = await command(
    { ...auth, 'x-rules-version': rulesVersion },
    '{"roomId":"nope"}',
  );
  const malformedBody = await malformed.json().catch(() => ({}));
  check(
    malformedBody.error === 'INVALID_REQUEST',
    'malformed command → INVALID_REQUEST',
    `HTTP ${malformed.status} ${malformedBody.error ?? ''}`,
  );

  const pipeline = await command({ ...auth, 'x-rules-version': rulesVersion }, valid);
  const pipelineBody = await pipeline.json().catch(() => ({}));
  check(
    pipelineBody.error === 'NOT_ROOM_MEMBER',
    'valid command reaches the authoritative pipeline (service-role DB access works)',
    `HTTP ${pipeline.status} ${pipelineBody.error ?? ''}`,
  );
}

// 4. CORS -----------------------------------------------------------------------------------
const preflight = (o) =>
  fetch(fnUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: o,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,x-rules-version,apikey',
    },
  });
if (origin) {
  const allowed = await preflight(origin);
  check(
    allowed.headers.get('access-control-allow-origin') === origin,
    `CORS allows ${origin}`,
    `HTTP ${allowed.status}`,
  );
}
const evil = await preflight('https://not-allowed.example');
check(
  evil.headers.get('access-control-allow-origin') !== '*' &&
    evil.headers.get('access-control-allow-origin') !== 'https://not-allowed.example',
  'CORS does not allow arbitrary origins',
);

console.log(
  failures === 0
    ? '\nAll hosted smoke checks passed.'
    : `\n${failures} hosted smoke check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
