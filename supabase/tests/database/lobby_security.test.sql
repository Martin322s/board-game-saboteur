-- =============================================================================================
-- Targeted lobby security tests (TEST_STRATEGY Tier C; run only with `npm run test:db`).
-- Everything runs in one transaction and is rolled back.
--
-- Impersonation: `set local role <role>` + request.jwt.claims (read by auth.uid()).
-- Results produced while impersonating are captured with set_config('t.*') and asserted after
-- `reset role`, except throws_ok checks, which must run as the impersonated role.
-- =============================================================================================
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(57);

-- Fixture identities -------------------------------------------------------------------------
insert into auth.users (id, aud, role)
select u::uuid, 'authenticated', 'authenticated'
from unnest(array[
  '00000000-0000-4000-8000-00000000000a', -- A  host / creator
  '00000000-0000-4000-8000-00000000000b', -- B
  '00000000-0000-4000-8000-00000000000c', -- C
  '00000000-0000-4000-8000-00000000000d', -- D
  '00000000-0000-4000-8000-00000000000e', -- E
  '00000000-0000-4000-8000-00000000000f', -- F  rate-limit probe (never a member)
  '00000000-0000-4000-8000-000000000010'  -- G  create-room rate-limit probe
]) as u;

-- =============================================================================================
-- Structure and privileges
-- =============================================================================================
select is(
  (select count(*)::int from pg_tables where schemaname in ('public', 'private') and not rowsecurity),
  0, 'every table in public/private has RLS enabled');

select set_eq(
  $$select tablename::text from pg_tables where schemaname = 'public'$$,
  array['rooms', 'room_players', 'games', 'rounds', 'round_events', 'round_player_private', 'score_entries'],
  'public schema contains only the expected lobby and game tables');

select is(
  (select count(*)::int from pg_tables
   where schemaname = 'public' and tablename in ('round_secrets', 'command_log', 'rate_limits', 'hands', 'roles')),
  0, 'server-only tables are not in the API-exposed public schema');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema in ('public', 'private') and grantee in ('anon', 'authenticated', 'PUBLIC')),
  0, 'anon/authenticated/PUBLIC hold no table privileges');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0, 'anon cannot execute any public/private function');

select set_eq(
  $$select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')$$,
  array['create_room', 'join_room', 'leave_room', 'set_ready', 'heartbeat', 'claim_host',
        'update_room_settings', 'kick_player', 'get_room_snapshot', 'get_my_active_room',
        'get_game_snapshot', 'get_my_game_state', 'reset_room'],
  'authenticated can execute exactly the lobby RPCs and the two game snapshot reads');

select set_eq(
  $$select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'EXECUTE')$$,
  array['can_access_room_topic'],
  'authenticated can execute only the realtime topic helper in private');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  0, 'every SECURITY DEFINER function pins search_path');

select ok(
  to_regclass('realtime.messages') is null
  or exists (select 1 from pg_policies
             where schemaname = 'realtime' and tablename = 'messages'
               and policyname = 'room members receive room broadcasts' and cmd = 'SELECT'),
  'room broadcast receive policy exists on realtime.messages');

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'realtime' and tablename = 'messages' and cmd in ('INSERT', 'ALL')
     and policyname ilike '%room%'),
  0, 'no client send/presence policy for room channels');

select is(
  (select count(*)::int from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname in ('public', 'private')),
  0, 'no lobby tables are published to Postgres Changes');

-- =============================================================================================
-- Authentication boundary
-- =============================================================================================
set local role anon;
select throws_ok($$select public.create_room('Анна', 4)$$, '42501', null,
  'anon (no session) cannot execute create_room');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select set_config('t.noauth', (public.create_room('Анна', 4))::text, true);
reset role;
select is(current_setting('t.noauth')::jsonb ->> 'error', 'UNAUTHENTICATED',
  'authenticated role without a subject is rejected');

-- =============================================================================================
-- create_room (A)
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select set_config('t.r1', (public.create_room('  Анна  ', 3))::text, true);
reset role;
select set_config('t.room', current_setting('t.r1')::jsonb ->> 'roomId', true);
select set_config('t.code', current_setting('t.r1')::jsonb ->> 'code', true);

select is((current_setting('t.r1')::jsonb ->> 'ok')::boolean, true,
  'anonymous authenticated user can create a room');
select ok(
  current_setting('t.code') ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'
  and exists (
    select 1 from public.rooms r join public.room_players p on p.id = r.host_player_id
    where r.id = current_setting('t.room')::uuid
      and p.user_id = '00000000-0000-4000-8000-00000000000a' and p.seat = 0
      and p.display_name = 'Анна' and r.capacity = 3 and r.status = 'LOBBY'),
  'creator is host at seat 0 with a trimmed name and a valid code');

-- =============================================================================================
-- Direct table access is denied (as A, a legitimate member)
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select throws_ok($$insert into public.rooms (code, capacity) values ('ABCDEF', 5)$$, '42501', null,
  'direct INSERT into rooms is denied');
select throws_ok($$update public.rooms set capacity = 10$$, '42501', null,
  'direct UPDATE of rooms is denied');
select throws_ok($$delete from public.rooms$$, '42501', null,
  'direct DELETE from rooms is denied');
select throws_ok($$select * from public.rooms$$, '42501', null,
  'direct SELECT from rooms is denied');
select throws_ok(
  $$insert into public.room_players (room_id, user_id, display_name, name_key, seat)
    values (gen_random_uuid(), '00000000-0000-4000-8000-00000000000a', 'Xx', 'xx', 1)$$,
  '42501', null, 'direct INSERT into room_players is denied');
select throws_ok($$update public.room_players set is_ready = true$$, '42501', null,
  'direct UPDATE of room_players (e.g. readying others) is denied');
select throws_ok($$select user_id from public.room_players$$, '42501', null,
  'direct SELECT of room_players is denied');
select throws_ok($$select * from private.rate_limits$$, '42501', null,
  'private bookkeeping tables are not readable');
select throws_ok(
  format($$select private.build_room_snapshot(%L, %L)$$, current_setting('t.room'),
         '00000000-0000-4000-8000-00000000000b'),
  '42501', null, 'private helpers cannot be called to read other members'' views');
reset role;

-- =============================================================================================
-- join_room (B, C) and name rules
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select set_config('t.b_dup', (public.join_room(current_setting('t.code'), 'АННА'))::text, true);
select set_config('t.b_join', (public.join_room(
  ' ' || lower(substr(current_setting('t.code'), 1, 3)) || '-' || lower(substr(current_setting('t.code'), 4)) || ' ',
  'Борис'))::text, true);
select set_config('t.b_again', (public.join_room(current_setting('t.code'), 'Друго име'))::text, true);
reset role;

select is(current_setting('t.b_dup')::jsonb ->> 'error', 'NAME_TAKEN',
  'display names are unique per room, case-insensitively');
select is((current_setting('t.b_join')::jsonb ->> 'ok')::boolean, true,
  'join accepts a lower-case code with spaces and dashes');
select is((current_setting('t.b_again')::jsonb ->> 'ok')::boolean, true,
  'joining again is an idempotent no-op');
select is(
  (select count(*)::int from public.room_players
   where room_id = current_setting('t.room')::uuid
     and user_id = '00000000-0000-4000-8000-00000000000b' and status = 'ACTIVE'),
  1, 'one identity holds at most one active seat (name unchanged by re-join)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select set_config('t.c_html', (public.join_room(current_setting('t.code'), '<b>x</b>'))::text, true);
select set_config('t.c_short', (public.join_room(current_setting('t.code'), ' Ц '))::text, true);
select set_config('t.c_ready', (public.set_ready(current_setting('t.room')::uuid, true))::text, true);
select set_config('t.c_snap', (public.get_room_snapshot(current_setting('t.code')))::text, true);
reset role;

select is(current_setting('t.c_html')::jsonb ->> 'error', 'INVALID_NAME', 'markup in names is rejected');
select is(current_setting('t.c_short')::jsonb ->> 'error', 'INVALID_NAME', 'names shorter than 2 characters are rejected');
select is(current_setting('t.c_ready')::jsonb ->> 'error', 'NOT_ROOM_MEMBER', 'a non-member cannot set ready');
select is(current_setting('t.c_snap')::jsonb ->> 'error', 'NOT_ROOM_MEMBER', 'a non-member cannot read the lobby snapshot');

-- =============================================================================================
-- Ready state and snapshot (B member, A host)
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select set_config('t.b_ready', (public.set_ready(current_setting('t.room')::uuid, true))::text, true);
select set_config('t.b_snap', (public.get_room_snapshot(lower(current_setting('t.code'))))::text, true);
select set_config('t.b_unknown', (public.get_room_snapshot('ZZZZZZ'))::text, true);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select set_config('t.a_ready', (public.set_ready(current_setting('t.room')::uuid, true))::text, true);
reset role;

select is((current_setting('t.b_ready')::jsonb #>> '{snapshot,me,isReady}')::boolean, true,
  'a member can set their own ready state');
select is(current_setting('t.a_ready')::jsonb ->> 'error', 'HOST_CANNOT_READY',
  'the host has no ready flag');
select is(current_setting('t.b_unknown')::jsonb ->> 'error', 'NOT_ROOM_MEMBER',
  'unknown codes are indistinguishable from non-membership');
select ok(
  jsonb_array_length(current_setting('t.b_snap')::jsonb #> '{snapshot,players}') = 2
  and (current_setting('t.b_snap')::jsonb #>> '{snapshot,start,canStart}')::boolean = false,
  'snapshot lists members and reports start ineligibility below 3 players');
select ok(
  position('00000000-0000-4000-8000-00000000000' in current_setting('t.b_snap')) = 0,
  'snapshot exposes no auth user ids');

-- =============================================================================================
-- Capacity (room capacity is 3)
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select set_config('t.c_join', (public.join_room(current_setting('t.code'), 'Цвета'))::text, true);
select set_config('t.c_ready2', (public.set_ready(current_setting('t.room')::uuid, true))::text, true);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
select set_config('t.d_full', (public.join_room(current_setting('t.code'), 'Дани'))::text, true);
reset role;

select is((current_setting('t.c_join')::jsonb ->> 'ok')::boolean, true, 'third player fills the room');
select is((current_setting('t.c_ready2')::jsonb #>> '{snapshot,start,canStart}')::boolean, true,
  'server reports canStart once 3 players are present and all non-hosts are ready');
select is(current_setting('t.d_full')::jsonb ->> 'error', 'ROOM_FULL', 'capacity is enforced by join_room');

-- Structural guarantee independent of RPC logic: seat < capacity plus unique active seats mean
-- a racing insert can never exceed capacity.
select throws_ok(
  format($$insert into public.room_players (room_id, user_id, display_name, name_key, seat)
           values (%L, '00000000-0000-4000-8000-00000000000d', 'Дани', 'дани', 5)$$, current_setting('t.room')),
  '23514', null, 'a seat outside the capacity is rejected by the database');
select throws_ok(
  format($$insert into public.room_players (room_id, user_id, display_name, name_key, seat)
           values (%L, '00000000-0000-4000-8000-00000000000d', 'Дани', 'дани', 1)$$, current_setting('t.room')),
  '23505', null, 'two active players cannot share a seat');
select throws_ok(
  format($$update public.rooms set capacity = 2 where id = %L$$, current_setting('t.room')),
  '23514', null, 'capacity changes are constrained by the database (range and occupied seats)');

-- =============================================================================================
-- Host migration
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select set_config('t.a_leave', (public.leave_room(current_setting('t.room')::uuid))::text, true);
reset role;

select is(
  (select p.user_id from public.rooms r join public.room_players p on p.id = r.host_player_id
   where r.id = current_setting('t.room')::uuid),
  '00000000-0000-4000-8000-00000000000b'::uuid,
  'when the host leaves, the lowest-seat connected member becomes host');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
select set_config('t.d_join', (public.join_room(current_setting('t.code'), 'Дани'))::text, true);
reset role;

select is(
  (select seat::int from public.room_players
   where room_id = current_setting('t.room')::uuid
     and user_id = '00000000-0000-4000-8000-00000000000d' and status = 'ACTIVE'),
  0, 'a newcomer takes the lowest free seat');

-- B (host, seat 1) stale 90 s; D (seat 0) away 50 s, so not "connected"; C (seat 2) fresh.
update public.room_players set last_seen_at = now() - interval '90 seconds'
 where room_id = current_setting('t.room')::uuid and user_id = '00000000-0000-4000-8000-00000000000b';
update public.room_players set last_seen_at = now() - interval '50 seconds'
 where room_id = current_setting('t.room')::uuid and user_id = '00000000-0000-4000-8000-00000000000d';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select set_config('t.c_claim', (public.claim_host(current_setting('t.room')::uuid))::text, true);
reset role;

select is(
  (select p.user_id from public.rooms r join public.room_players p on p.id = r.host_player_id
   where r.id = current_setting('t.room')::uuid),
  '00000000-0000-4000-8000-00000000000c'::uuid,
  'a stale host is replaced by the lowest-seat member seen within 45 s');

-- =============================================================================================
-- Lazy stale-member removal (no scheduler)
-- =============================================================================================
update public.room_players set last_seen_at = now() - interval '130 seconds'
 where room_id = current_setting('t.room')::uuid and user_id = '00000000-0000-4000-8000-00000000000d';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
select set_config('t.e_join', (public.join_room(current_setting('t.code'), 'Елена'))::text, true);
reset role;

select is((current_setting('t.e_join')::jsonb ->> 'ok')::boolean, true,
  'joining a full room succeeds when a member has been stale for > 120 s');
select is(
  (select status from public.room_players
   where room_id = current_setting('t.room')::uuid and user_id = '00000000-0000-4000-8000-00000000000d'
   order by joined_at desc limit 1),
  'REMOVED', 'the stale member was removed lazily by the join');

-- =============================================================================================
-- Host-only lobby controls
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select set_config('t.b_cap', (public.update_room_settings(current_setting('t.room')::uuid, 5))::text, true);
select set_config('t.b_kick', (public.kick_player(current_setting('t.room')::uuid,
  (current_setting('t.c_ready2')::jsonb #>> '{snapshot,me,playerId}')::uuid))::text, true);
reset role;

select is(current_setting('t.b_cap')::jsonb ->> 'error', 'NOT_HOST', 'only the host can change capacity');
select is(current_setting('t.b_kick')::jsonb ->> 'error', 'NOT_HOST', 'only the host can remove players');

-- =============================================================================================
-- Rate limits: rejected attempts count too (errors are returned, not raised)
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
select set_config('t.f_fail', (
  select (count(*) filter (where (public.join_room('ZZZZZZ', 'Фреди')) ->> 'error' = 'ROOM_NOT_FOUND'))::text
  from generate_series(1, 20)), true);
select set_config('t.f_limited', (public.join_room('ZZZZZZ', 'Фреди'))::text, true);
select set_config('t.f_topic', (private.can_access_room_topic('room:' || current_setting('t.room')))::text, true);
reset role;

select is(current_setting('t.f_fail')::int, 20, '20 failed joins are processed');
select is(current_setting('t.f_limited')::jsonb ->> 'error', 'RATE_LIMITED',
  'the 21st join attempt in 10 minutes is rate limited (code brute force)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000010","role":"authenticated"}', true);
select set_config('t.g_cap', (public.create_room('Гошо', 11))::text, true);
select set_config('t.g_seq', (
  select string_agg(coalesce(r ->> 'error', 'OK'), ',' order by g)
  from (select g, public.create_room('Гошо', 4) as r from generate_series(1, 5) as g) x), true);
reset role;

select is(current_setting('t.g_cap')::jsonb ->> 'error', 'INVALID_CAPACITY', 'capacity outside 3–10 is rejected');
select is(current_setting('t.g_seq'), 'OK,OK,OK,TOO_MANY_ROOMS,RATE_LIMITED',
  'per-user room cap, then create_room rate limit (5 attempts / 10 min, failures included)');

-- =============================================================================================
-- Realtime topic authorization helper
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select set_config('t.c_topic', (private.can_access_room_topic('room:' || current_setting('t.room')))::text, true);
select set_config('t.c_bad', (private.can_access_room_topic('room:not-a-uuid'))::text, true);
reset role;

select is(current_setting('t.c_topic')::boolean, true, 'members may receive their room channel');
select is(current_setting('t.f_topic')::boolean, false, 'non-members may not receive a room channel');
select is(current_setting('t.c_bad')::boolean, false, 'malformed topics are rejected');

select * from finish();
rollback;
