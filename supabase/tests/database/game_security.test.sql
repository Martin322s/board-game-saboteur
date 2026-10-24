-- =============================================================================================
-- Targeted gameplay persistence/security tests (Prompt 3). Rolled back at the end.
--
-- The trusted persistence functions are called as `service_role` (what the Edge Function's key
-- can do) with synthetic payloads containing unique MARKER strings, so leaks are detectable
-- without depending on the TypeScript domain. Gameplay rules are tested in the domain suite.
-- =============================================================================================
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(37);

insert into auth.users (id, aud, role)
select u::uuid, 'authenticated', 'authenticated'
from unnest(array[
  '00000000-0000-4000-8000-0000000000a1', -- A host
  '00000000-0000-4000-8000-0000000000b1', -- B
  '00000000-0000-4000-8000-0000000000c1', -- C
  '00000000-0000-4000-8000-0000000000d1'  -- D non-member
]) as u;

-- Lobby: A creates, B and C join and get ready -----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('t.r', (public.create_room('Ана', 3))::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select public.join_room(current_setting('t.r')::jsonb ->> 'code', 'Боби');
select public.set_ready((current_setting('t.r')::jsonb ->> 'roomId')::uuid, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select public.join_room(current_setting('t.r')::jsonb ->> 'code', 'Цеци');
select public.set_ready((current_setting('t.r')::jsonb ->> 'roomId')::uuid, true);
reset role;

select set_config('t.room', current_setting('t.r')::jsonb ->> 'roomId', true);
select set_config('t.pa', (select id::text from public.room_players where room_id = current_setting('t.room')::uuid and user_id = '00000000-0000-4000-8000-0000000000a1'), true);
select set_config('t.pb', (select id::text from public.room_players where room_id = current_setting('t.room')::uuid and user_id = '00000000-0000-4000-8000-0000000000b1'), true);
select set_config('t.pc', (select id::text from public.room_players where room_id = current_setting('t.room')::uuid and user_id = '00000000-0000-4000-8000-0000000000c1'), true);

-- Synthetic round payloads -----------------------------------------------------------------
select set_config('t.public', jsonb_build_object(
  'players', jsonb_build_array(
    jsonb_build_object('playerId', current_setting('t.pa')),
    jsonb_build_object('playerId', current_setting('t.pb')),
    jsonb_build_object('playerId', current_setting('t.pc'))),
  'board', '{"destinations":[{"slot":0,"revealed":null}]}'::jsonb)::text, true);
select set_config('t.secret', '{"drawPile":["SECRET-DECK-MARKER"],"setAsideRole":"SETASIDE-MARKER","destinationIdentities":["GOLD-MARKER"]}', true);
select set_config('t.privates', jsonb_build_array(
  jsonb_build_object('playerId', current_setting('t.pa'), 'state', '{"role":"ROLE-A-MARKER","hand":["HAND-A-MARKER"],"knownDestinations":["SURVEY-A-MARKER"]}'::jsonb),
  jsonb_build_object('playerId', current_setting('t.pb'), 'state', '{"role":"ROLE-B-MARKER","hand":["HAND-B-MARKER"],"knownDestinations":["SURVEY-B-MARKER"]}'::jsonb),
  jsonb_build_object('playerId', current_setting('t.pc'), 'state', '{"role":"ROLE-C-MARKER","hand":["HAND-C-MARKER"],"knownDestinations":[]}'::jsonb))::text, true);

select set_config('t.start', jsonb_build_object(
  'userId', '00000000-0000-4000-8000-0000000000a1', 'roomId', current_setting('t.room'),
  'commandId', '10000000-0000-4000-8000-000000000001', 'commandType', 'START_GAME',
  'fingerprint', 'fp-start', 'expectedVersion', null, 'response', '{"ok":true}'::jsonb,
  'playerIds', jsonb_build_array(current_setting('t.pa'), current_setting('t.pb'), current_setting('t.pc')),
  'rulesVersion', 1, 'seed', 'SEED-MARKER',
  'round', jsonb_build_object(
    'roundNo', 1, 'version', 1, 'phase', 'ROUND_ACTIVE', 'activePlayerId', current_setting('t.pa'),
    'turnNumber', 1, 'turnDeadline', 4102444800000, 'startingSeat', 0, 'lastEventSeq', 1,
    'publicState', current_setting('t.public')::jsonb, 'state', current_setting('t.secret')::jsonb),
  'privateStates', current_setting('t.privates')::jsonb,
  'events', '[{"seq":1,"type":"ROUND_STARTED"}]'::jsonb)::text, true);

-- =============================================================================================
-- Privileges
-- =============================================================================================
select ok(
  has_function_privilege('service_role', 'public.game_persist_start(jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.game_persist_transition(jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.game_persist_next_round(jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.game_persist_leave_ended(jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.game_server_context(jsonb)', 'EXECUTE'),
  'the trusted server path (service_role) can execute the persistence functions');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$select public.game_persist_start(current_setting('t.start')::jsonb)$$, '42501', null,
  'an authenticated player cannot call the trusted start persistence');
select throws_ok($$select public.game_persist_transition('{}'::jsonb)$$, '42501', null,
  'an authenticated player cannot call the trusted transition persistence');
select throws_ok($$select public.game_server_context('{}'::jsonb)$$, '42501', null,
  'an authenticated player cannot read the server context (secrets)');
reset role;
set local role anon;
select throws_ok($$select public.get_game_snapshot(gen_random_uuid())$$, '42501', null,
  'anon cannot read game snapshots');
reset role;

-- =============================================================================================
-- START (host-only, exactly once)
-- =============================================================================================
set local role service_role;
select set_config('t.s_nonhost', (public.game_persist_start(
  jsonb_set(current_setting('t.start')::jsonb, '{userId}', '"00000000-0000-4000-8000-0000000000b1"')))::text, true);
select set_config('t.s_ok', (public.game_persist_start(current_setting('t.start')::jsonb))::text, true);
select set_config('t.s_again', (public.game_persist_start(
  jsonb_set(current_setting('t.start')::jsonb, '{commandId}', '"10000000-0000-4000-8000-000000000009"')))::text, true);
reset role;

select is(current_setting('t.s_nonhost')::jsonb ->> 'error', 'NOT_HOST', 'only the host can start the game');
select is((current_setting('t.s_ok')::jsonb ->> 'ok')::boolean, true, 'the host starts the game');
select is(current_setting('t.s_again')::jsonb ->> 'error', 'GAME_ALREADY_STARTED', 'a game cannot be started twice');
select is((select count(*)::int from public.games where room_id = current_setting('t.room')::uuid), 1,
  'exactly one game exists for the room');
select set_config('t.game', current_setting('t.s_ok')::jsonb #>> '{response,gameId}', true);
select set_config('t.round', current_setting('t.s_ok')::jsonb #>> '{response,roundId}', true);

-- =============================================================================================
-- Direct table access is denied (as player A)
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$select * from public.games$$, '42501', null, 'games are not directly readable');
select throws_ok($$select * from public.rounds$$, '42501', null, 'rounds are not directly readable');
select throws_ok($$select * from public.round_player_private$$, '42501', null, 'private projections are not directly readable');
select throws_ok($$select * from public.score_entries$$, '42501', null, 'scores are not directly readable');
select throws_ok($$select * from private.round_secrets$$, '42501', null, 'secret round state (deck, roles, gold) is not readable');
select throws_ok($$select * from private.command_log$$, '42501', null, 'the command log is not readable');
select throws_ok($$insert into public.games (room_id, rules_version) values (gen_random_uuid(), 1)$$, '42501', null, 'games cannot be inserted directly');
select throws_ok($$update public.rounds set state_version = 99$$, '42501', null, 'rounds cannot be updated directly');
select throws_ok($$delete from public.round_player_private$$, '42501', null, 'private projections cannot be deleted directly');

-- Private snapshots: own data only -----------------------------------------------------------
select set_config('t.a_mine', (public.get_my_game_state(current_setting('t.room')::uuid))::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select set_config('t.b_mine', (public.get_my_game_state(current_setting('t.room')::uuid))::text, true);
select set_config('t.b_pub', (public.get_game_snapshot(current_setting('t.room')::uuid))::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
select set_config('t.d_pub', (public.get_game_snapshot(current_setting('t.room')::uuid))::text, true);
select set_config('t.d_mine', (public.get_my_game_state(current_setting('t.room')::uuid))::text, true);
reset role;

select ok(
  current_setting('t.a_mine') like '%HAND-A-MARKER%' and current_setting('t.a_mine') like '%ROLE-A-MARKER%'
  and current_setting('t.a_mine') not like '%-B-MARKER%' and current_setting('t.a_mine') not like '%-C-MARKER%',
  'player A gets only their own role, hand and survey knowledge');
select ok(
  current_setting('t.b_mine') like '%HAND-B-MARKER%'
  and current_setting('t.b_mine') not like '%-A-MARKER%' and current_setting('t.b_mine') not like '%-C-MARKER%',
  'player B cannot obtain player A''s hand, role or survey result');
select ok(
  current_setting('t.b_pub') !~ '(SECRET-DECK|SETASIDE|GOLD|SEED|HAND-|ROLE-|SURVEY-)',
  'the public snapshot contains no deck order, set-aside role, gold location, seed or private data');
select ok((current_setting('t.b_pub')::jsonb #> '{snapshot,round,reveal}') = 'null'::jsonb,
  'no role reveal while the round is active');
select is(current_setting('t.d_pub')::jsonb ->> 'error', 'NOT_ROOM_MEMBER', 'a non-member cannot read the game snapshot');
select is(current_setting('t.d_mine')::jsonb ->> 'error', 'NOT_ROOM_MEMBER', 'a non-member cannot read private state');

-- =============================================================================================
-- Transitions: compare-and-swap + idempotency
-- =============================================================================================
select set_config('t.tr', jsonb_build_object(
  'userId', '00000000-0000-4000-8000-0000000000a1', 'roomId', current_setting('t.room'),
  'gameId', current_setting('t.game'), 'roundId', current_setting('t.round'),
  'commandId', '10000000-0000-4000-8000-000000000002', 'commandType', 'DISCARD', 'fingerprint', 'fp-2',
  'expectedVersion', 1, 'response', '{"ok":true,"version":2}'::jsonb,
  'round', jsonb_build_object(
    'version', 2, 'phase', 'ROUND_ACTIVE', 'activePlayerId', current_setting('t.pb'), 'turnNumber', 2,
    'turnDeadline', 4102444800000, 'lastEventSeq', 2,
    'publicState', current_setting('t.public')::jsonb, 'state', current_setting('t.secret')::jsonb),
  'privateStates', current_setting('t.privates')::jsonb,
  'events', '[{"seq":2,"type":"CARD_DISCARDED"}]'::jsonb,
  'roundEnd', null, 'gameFinish', null, 'leftPlayerIds', '[]'::jsonb)::text, true);

set local role service_role;
select set_config('t.t_ok', (public.game_persist_transition(current_setting('t.tr')::jsonb))::text, true);
-- Same command id again (at the new version): must not apply a second transition.
select set_config('t.t_dup', (public.game_persist_transition(
  current_setting('t.tr')::jsonb
  || '{"expectedVersion":2}'::jsonb
  || jsonb_build_object('round', (current_setting('t.tr')::jsonb -> 'round') || '{"version":3,"lastEventSeq":3}'::jsonb)
  || '{"events":[{"seq":3,"type":"CARD_DISCARDED"}]}'::jsonb))::text, true);
-- A different command computed from a stale version.
select set_config('t.t_stale', (public.game_persist_transition(
  current_setting('t.tr')::jsonb || '{"commandId":"10000000-0000-4000-8000-000000000003"}'::jsonb))::text, true);
reset role;

select is((current_setting('t.t_ok')::jsonb ->> 'ok')::boolean, true, 'a transition at the current version commits');
select is(current_setting('t.t_dup')::jsonb ->> 'error', 'COMMAND_ID_REUSED', 'a command id cannot execute twice');
select is(current_setting('t.t_stale')::jsonb ->> 'error', 'STALE_STATE', 'compare-and-swap rejects a stale expected version');
select ok(
  (select state_version from public.rounds where id = current_setting('t.round')::uuid) = 2
  and (select state_version from private.round_secrets where round_id = current_setting('t.round')::uuid) = 2
  and (select count(*) from public.round_events where round_id = current_setting('t.round')::uuid) = 2,
  'the version advanced exactly once and the rejected requests left no partial writes');

-- =============================================================================================
-- Round end: results persisted, reveal becomes available, secrets dropped
-- =============================================================================================
set local role service_role;
select set_config('t.t_end', (public.game_persist_transition(
  current_setting('t.tr')::jsonb
  || '{"commandId":"10000000-0000-4000-8000-000000000004","expectedVersion":2}'::jsonb
  || jsonb_build_object('round', (current_setting('t.tr')::jsonb -> 'round')
       || '{"version":3,"phase":"ROUND_ENDED","activePlayerId":null,"turnDeadline":null,"lastEventSeq":3}'::jsonb)
  || '{"events":[{"seq":3,"type":"ROUND_ENDED"}]}'::jsonb
  || jsonb_build_object('roundEnd', jsonb_build_object(
       'winner', 'DISRUPTOR', 'endReason', 'EXHAUSTED', 'connectorId', null,
       'endedAt', 1700000000000, 'resultsDeadline', 1700000045000,
       'reveal', '{"roles":"REVEAL-MARKER"}'::jsonb,
       'scores', jsonb_build_array(
         jsonb_build_object('playerId', current_setting('t.pa'), 'points', 0, 'reason', 'LOST'),
         jsonb_build_object('playerId', current_setting('t.pb'), 'points', 4, 'reason', 'DISRUPTORS_WON_SOLE'),
         jsonb_build_object('playerId', current_setting('t.pc'), 'points', 0, 'reason', 'LOST')))))
  )::text, true);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select set_config('t.c_pub', (public.get_game_snapshot(current_setting('t.room')::uuid))::text, true);
reset role;

select is((current_setting('t.t_end')::jsonb ->> 'ok')::boolean, true, 'the round-ending transition commits');
select is(current_setting('t.c_pub')::jsonb #>> '{snapshot,round,reveal,roles}', 'REVEAL-MARKER',
  'the approved reveal is available after the round ended');
select is(current_setting('t.c_pub')::jsonb #>> '{snapshot,round,result,winner}', 'DISRUPTOR', 'the result is public after the end');
select is(jsonb_array_length(current_setting('t.c_pub')::jsonb #> '{snapshot,scores}'), 3, 'round scores are persisted');
select is((select count(*)::int from private.round_secrets where round_id = current_setting('t.round')::uuid), 0,
  'secret round state is deleted once the round is resolved');

-- =============================================================================================
-- Play again: FINISHED room → fresh LOBBY (host only, readiness reset, new game needs ready-up)
-- =============================================================================================
update public.games set status = 'FINISHED', end_reason = 'COMPLETED', finished_at = now()
 where id = current_setting('t.game')::uuid;
update public.rooms set status = 'FINISHED' where id = current_setting('t.room')::uuid;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select set_config('t.rs_b', (public.reset_room(current_setting('t.room')::uuid))::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('t.rs_a', (public.reset_room(current_setting('t.room')::uuid))::text, true);
reset role;

set local role service_role;
select set_config('t.s_new', (public.game_persist_start(
  jsonb_set(current_setting('t.start')::jsonb, '{commandId}', '"10000000-0000-4000-8000-000000000010"')))::text, true);
reset role;

select is(current_setting('t.rs_b')::jsonb ->> 'error', 'NOT_HOST', 'only the host can return a finished room to the lobby');
select is((current_setting('t.rs_a')::jsonb ->> 'ok')::boolean, true, 'the host returns the finished room to the lobby');
select ok(
  (select status from public.rooms where id = current_setting('t.room')::uuid) = 'LOBBY'
  and not exists (select 1 from public.room_players
                  where room_id = current_setting('t.room')::uuid and status = 'ACTIVE' and is_ready),
  'play again keeps the room and code but resets readiness');
select is(current_setting('t.s_new')::jsonb ->> 'error', 'PLAYERS_NOT_READY',
  'a new game cannot start until players ready up again');

select * from finish();
rollback;
