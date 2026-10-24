-- =============================================================================================
-- Authoritative gameplay persistence (ARCHITECTURE §5, §8; SECURITY_MODEL §1–§2).
--
-- Rules live ONLY in the TypeScript domain, executed by the `game-command` Edge Function.
-- This SQL persists already-validated transitions, enforces ownership/authorization invariants,
-- compare-and-swap on state_version, and command idempotency. It makes no gameplay decisions.
--
-- Information classes:
--   PUBLIC (room members, via get_game_snapshot):  games, rounds.public_state, round_events,
--                                                  score_entries, rounds.reveal (after end only)
--   PLAYER-PRIVATE (owner only, get_my_game_state): round_player_private
--   SERVER-ONLY (no client path at all):           private.round_secrets, private.command_log
-- Clients have NO table privileges on any of these; reads go through the two snapshot RPCs.
-- Writes go only through game_persist_* functions, executable by service_role only.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  status text not null default 'IN_PROGRESS',
  mode text not null default 'STANDARD',
  total_rounds smallint not null default 3,
  current_round_no smallint not null default 1,
  rules_version integer not null,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint games_status_valid check (status in ('IN_PROGRESS', 'FINISHED', 'ABANDONED')),
  constraint games_rounds_valid check (current_round_no between 1 and total_rounds),
  constraint games_finished_at_consistent check ((status = 'IN_PROGRESS') = (finished_at is null))
);
-- Exactly one running game per room (START_GAME double-click / concurrency backstop).
create unique index games_one_in_progress_per_room on public.games (room_id) where status = 'IN_PROGRESS';
create index games_room_created_idx on public.games (room_id, created_at desc);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  round_no smallint not null,
  phase text not null,
  state_version integer not null,
  rules_version integer not null,
  active_player_id uuid,
  turn_number integer not null,
  turn_deadline timestamptz,
  starting_seat smallint not null,
  -- Domain projectPublic(state): board, tool states, hand COUNTS, pile COUNTS, turn metadata.
  public_state jsonb not null,
  last_event_seq integer not null default 0,
  -- Round result (null while active).
  winner text,
  end_reason text,
  connector_player_id uuid,
  results_deadline timestamptz,
  -- Domain projectReveal(state): every role, the set-aside role, all destination identities.
  reveal jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint rounds_game_round_key unique (game_id, round_no),
  constraint rounds_phase_valid check (phase in ('ROUND_ACTIVE', 'ROUND_ENDED')),
  constraint rounds_version_positive check (state_version > 0),
  constraint rounds_winner_valid check (winner is null or winner in ('MINER', 'DISRUPTOR', 'NONE')),
  -- Role/destination reveal can only exist once the round has ended (SECURITY_MODEL T2).
  constraint rounds_reveal_only_when_ended check (
    phase = 'ROUND_ENDED' or (reveal is null and winner is null and ended_at is null))
);
create index rounds_room_idx on public.rounds (room_id);

create table public.round_events (
  round_id uuid not null references public.rounds (id) on delete cascade,
  seq integer not null,
  room_id uuid not null references public.rooms (id) on delete cascade,
  event jsonb not null,
  created_at timestamptz not null default now(),
  primary key (round_id, seq)
);

create table public.round_player_private (
  round_id uuid not null references public.rounds (id) on delete cascade,
  player_id uuid not null references public.room_players (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  state_version integer not null,
  -- Domain projectPrivate(state, player): own role, own hand (with handPosition), own surveys.
  private_state jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (round_id, player_id)
);

create table public.score_entries (
  game_id uuid not null references public.games (id) on delete cascade,
  round_no smallint not null,
  player_id uuid not null references public.room_players (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  points smallint not null,
  reason text not null,
  primary key (game_id, round_no, player_id),
  constraint score_entries_points_non_negative check (points >= 0)
);

-- Full authoritative domain RoundState (deck order, every hand, every role, set-aside role,
-- destination identities) and the production seed. Deleted when the round ends.
create table private.round_secrets (
  round_id uuid primary key references public.rounds (id) on delete cascade,
  state_version integer not null,
  state jsonb not null,
  seed text not null,
  updated_at timestamptz not null default now()
);

-- Idempotency log for successful gameplay commands (one row per committed transition).
create table private.command_log (
  command_id uuid primary key,
  user_id uuid not null,
  room_id uuid not null references public.rooms (id) on delete cascade,
  game_id uuid,
  round_id uuid,
  command_type text not null,
  -- Canonical JSON of the request (roomId, expectedVersion, command) for reuse detection.
  fingerprint text not null,
  expected_version integer,
  result_version integer,
  -- The stored safe response for the issuing user (may contain that user's own private effects).
  response jsonb not null,
  created_at timestamptz not null default now()
);
create index command_log_created_idx on private.command_log (created_at);

-- ---------------------------------------------------------------------------------------------
-- Grants / RLS: no client access to any gameplay table.
-- ---------------------------------------------------------------------------------------------
alter table public.games enable row level security;
alter table public.rounds enable row level security;
alter table public.round_events enable row level security;
alter table public.round_player_private enable row level security;
alter table public.score_entries enable row level security;
alter table private.round_secrets enable row level security;
alter table private.command_log enable row level security;

revoke all on table
  public.games, public.rounds, public.round_events, public.round_player_private, public.score_entries
from public, anon, authenticated;
revoke all on table private.round_secrets, private.command_log from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------------------------
create function private.to_ms(p_time timestamptz)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when p_time is null then null
              else pg_catalog.floor(extract(epoch from p_time) * 1000)::bigint end
$$;

create function private.from_ms(p_ms jsonb)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case when p_ms is null or pg_catalog.jsonb_typeof(p_ms) = 'null' then null
              else pg_catalog.to_timestamp((p_ms #>> '{}')::double precision / 1000.0) end
$$;

-- Notification only: {gameId, roundId, version}. Never cards, roles or identities.
create function private.broadcast_game_changed(p_room_id uuid, p_game_id uuid, p_round_id uuid, p_version integer)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform realtime.send(
    pg_catalog.jsonb_build_object('gameId', p_game_id, 'roundId', p_round_id, 'version', p_version),
    'game_changed',
    'room:' || p_room_id::text,
    true
  );
exception when others then
  raise warning 'game_changed broadcast failed for room %: %', p_room_id, sqlerrm;
end;
$$;

-- Sorted active member ids of a room (for comparing against the player set a round was built for).
create function private.active_member_ids(p_room_id uuid)
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(p.id order by p.id), '{}')
  from public.room_players p
  where p.room_id = p_room_id and p.status = 'ACTIVE'
$$;

create function private.uuid_array(p_values jsonb)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(v::uuid order by v::uuid), '{}')
  from pg_catalog.jsonb_array_elements_text(coalesce(p_values, '[]'::jsonb)) as v
$$;

create function private.log_command(
  p jsonb, p_game_id uuid, p_round_id uuid, p_result_version integer, p_response jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into private.command_log
    (command_id, user_id, room_id, game_id, round_id, command_type, fingerprint,
     expected_version, result_version, response)
  values (
    (p ->> 'commandId')::uuid, (p ->> 'userId')::uuid, (p ->> 'roomId')::uuid, p_game_id, p_round_id,
    p ->> 'commandType', p ->> 'fingerprint', (p ->> 'expectedVersion')::integer,
    p_result_version, p_response)
$$;

-- Insert a freshly created round (public header, server-only secrets, private projections,
-- initial events). `p_round` is built by the domain (createRound + projections).
create function private.insert_round(
  p_game_id uuid, p_room_id uuid, p_round jsonb, p_rules_version integer, p_seed text,
  p_private_states jsonb, p_events jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_round_id uuid;
  v_version integer := (p_round ->> 'version')::integer;
begin
  insert into public.rounds
    (game_id, room_id, round_no, phase, state_version, rules_version, active_player_id,
     turn_number, turn_deadline, starting_seat, public_state, last_event_seq)
  values (
    p_game_id, p_room_id, (p_round ->> 'roundNo')::smallint, p_round ->> 'phase', v_version,
    p_rules_version, (p_round ->> 'activePlayerId')::uuid, (p_round ->> 'turnNumber')::integer,
    private.from_ms(p_round -> 'turnDeadline'), (p_round ->> 'startingSeat')::smallint,
    p_round -> 'publicState', (p_round ->> 'lastEventSeq')::integer)
  returning id into v_round_id;

  insert into private.round_secrets (round_id, state_version, state, seed)
  values (v_round_id, v_version, p_round -> 'state', p_seed);

  insert into public.round_player_private (round_id, player_id, room_id, state_version, private_state)
  select v_round_id, (x ->> 'playerId')::uuid, p_room_id, v_version, x -> 'state'
  from pg_catalog.jsonb_array_elements(coalesce(p_private_states, '[]'::jsonb)) as x;

  insert into public.round_events (round_id, seq, room_id, event)
  select v_round_id, (e ->> 'seq')::integer, p_room_id, e
  from pg_catalog.jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) as e;

  return v_round_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Trusted server API (service_role only; called by the game-command Edge Function)
-- All take a single jsonb argument and return {ok:true,...} | {ok:false,error}.
-- `userId` is the identity the Edge Function verified from the caller's JWT.
-- ---------------------------------------------------------------------------------------------

-- Everything the Edge Function needs to evaluate a command, including secrets.
-- Also consumes the per-user gameplay rate limit (committed even if the command is rejected).
create function public.game_server_context(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (p ->> 'userId')::uuid;
  v_room public.rooms;
  v_me public.room_players;
  v_log private.command_log;
  v_game public.games;
  v_round public.rounds;
  v_secret private.round_secrets;
begin
  if v_user is null or (p ->> 'roomId') is null then
    return private.lobby_error('INVALID_REQUEST');
  end if;
  if coalesce((p ->> 'rateLimit')::boolean, false)
     and not private.consume_rate_limit(v_user, 'game_command', 120, interval '1 minute') then
    return private.lobby_error('RATE_LIMITED');
  end if;

  select * into v_room from public.rooms where id = (p ->> 'roomId')::uuid;
  select * into v_me from public.room_players
   where room_id = v_room.id and user_id = v_user and status = 'ACTIVE';
  if v_room.id is null or v_me.id is null then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;

  if (p ->> 'commandId') is not null then
    select * into v_log from private.command_log where command_id = (p ->> 'commandId')::uuid;
  end if;
  select * into v_game from public.games where room_id = v_room.id order by created_at desc limit 1;
  if v_game.id is not null then
    select * into v_round from public.rounds
     where game_id = v_game.id and round_no = v_game.current_round_no;
    if v_round.id is not null then
      select * into v_secret from private.round_secrets where round_id = v_round.id;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'serverNow', private.to_ms(pg_catalog.clock_timestamp()),
    'me', pg_catalog.jsonb_build_object(
      'playerId', v_me.id, 'seat', v_me.seat, 'isHost', v_room.host_player_id = v_me.id),
    'room', pg_catalog.jsonb_build_object(
      'id', v_room.id, 'status', v_room.status, 'version', v_room.room_version,
      'hostPlayerId', v_room.host_player_id),
    'members', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'playerId', m.id, 'seat', m.seat, 'isReady', m.is_ready) order by m.seat)
      from public.room_players m where m.room_id = v_room.id and m.status = 'ACTIVE'), '[]'::jsonb),
    'loggedCommand', case when v_log.command_id is null then null else pg_catalog.jsonb_build_object(
      'userId', v_log.user_id, 'roomId', v_log.room_id, 'fingerprint', v_log.fingerprint,
      'response', v_log.response) end,
    'game', case when v_game.id is null then null else pg_catalog.jsonb_build_object(
      'id', v_game.id, 'status', v_game.status, 'currentRoundNo', v_game.current_round_no,
      'totalRounds', v_game.total_rounds) end,
    'round', case when v_round.id is null then null else pg_catalog.jsonb_build_object(
      'id', v_round.id, 'roundNo', v_round.round_no, 'phase', v_round.phase,
      'version', v_round.state_version, 'turnNumber', v_round.turn_number,
      'startingSeat', v_round.starting_seat,
      'resultsDeadline', private.to_ms(v_round.results_deadline)) end,
    'secret', case when v_secret.round_id is null then null else pg_catalog.jsonb_build_object(
      'version', v_secret.state_version, 'state', v_secret.state) end
  );
end;
$$;

-- START_GAME: lobby guards are re-checked under the room lock; the round itself was built by the
-- domain from exactly `playerIds`, which must still equal the room's active members.
create function public.game_persist_start(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_me public.room_players;
  v_count integer;
  v_not_ready integer;
  v_game_id uuid;
  v_round_id uuid;
  v_version integer := (p #>> '{round,version}')::integer;
  v_response jsonb;
begin
  select * into v_room from public.rooms where id = (p ->> 'roomId')::uuid for update;
  if not found then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;
  select * into v_me from public.room_players
   where room_id = v_room.id and user_id = (p ->> 'userId')::uuid and status = 'ACTIVE';
  if not found then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;
  if v_room.status = 'IN_GAME'
     or exists (select 1 from public.games where room_id = v_room.id and status = 'IN_PROGRESS') then
    return private.lobby_error('GAME_ALREADY_STARTED');
  end if;
  if v_room.status <> 'LOBBY' then
    return private.lobby_error('NOT_IN_LOBBY');
  end if;
  if v_room.host_player_id is distinct from v_me.id then
    return private.lobby_error('NOT_HOST');
  end if;

  select pg_catalog.count(*),
         pg_catalog.count(*) filter (where m.id <> v_room.host_player_id and not m.is_ready)
    into v_count, v_not_ready
  from public.room_players m where m.room_id = v_room.id and m.status = 'ACTIVE';
  if v_count < 3 or v_count > v_room.capacity then
    return private.lobby_error('NOT_ENOUGH_PLAYERS');
  end if;
  if v_not_ready > 0 then
    return private.lobby_error('PLAYERS_NOT_READY');
  end if;
  if private.active_member_ids(v_room.id) <> private.uuid_array(p -> 'playerIds') then
    return private.lobby_error('STALE_STATE');
  end if;

  insert into public.games (room_id, rules_version, total_rounds, current_round_no)
  values (v_room.id, (p ->> 'rulesVersion')::integer, 3, 1)
  returning id into v_game_id;

  v_round_id := private.insert_round(
    v_game_id, v_room.id, p -> 'round', (p ->> 'rulesVersion')::integer, p ->> 'seed',
    p -> 'privateStates', p -> 'events');

  update public.rooms set status = 'IN_GAME' where id = v_room.id;

  v_response := coalesce(p -> 'response', '{}'::jsonb)
    || pg_catalog.jsonb_build_object('gameId', v_game_id, 'roundId', v_round_id, 'version', v_version);
  perform private.log_command(p, v_game_id, v_round_id, v_version, v_response);

  perform private.touch_room(v_room.id);
  perform private.broadcast_game_changed(v_room.id, v_game_id, v_round_id, v_version);
  return pg_catalog.jsonb_build_object('ok', true, 'response', v_response);
end;
$$;

-- One committed command: compare-and-swap on the secret state version, then update every
-- projection, the command log and (if the round ended) results — all in one transaction.
create function public.game_persist_transition(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid := (p ->> 'roomId')::uuid;
  v_round_id uuid := (p ->> 'roundId')::uuid;
  v_expected integer := (p ->> 'expectedVersion')::integer;
  v_new integer := (p #>> '{round,version}')::integer;
  v_end jsonb := p -> 'roundEnd';
  v_game public.games;
  v_round public.rounds;
  v_rows integer;
  v_room_changed boolean := false;
  v_constraint text;
begin
  select * into v_game from public.games
   where id = (p ->> 'gameId')::uuid and room_id = v_room_id for update;
  if not found or v_game.status <> 'IN_PROGRESS' then
    return private.lobby_error('GAME_NOT_IN_PROGRESS');
  end if;
  select * into v_round from public.rounds where id = v_round_id and game_id = v_game.id;
  if not found or v_round.round_no <> v_game.current_round_no then
    return private.lobby_error('STALE_STATE');
  end if;
  if not exists (
    select 1 from public.room_players
    where room_id = v_room_id and user_id = (p ->> 'userId')::uuid and status = 'ACTIVE'
  ) then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;
  if v_expected is null or v_new is distinct from v_expected + 1 then
    return private.lobby_error('INVALID_REQUEST');
  end if;

  begin
    update private.round_secrets
       set state = p #> '{round,state}', state_version = v_new, updated_at = now()
     where round_id = v_round_id and state_version = v_expected;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'error', 'STALE_STATE', 'currentVersion', v_round.state_version);
    end if;

    update public.rounds
       set phase = p #>> '{round,phase}',
           state_version = v_new,
           active_player_id = (p #>> '{round,activePlayerId}')::uuid,
           turn_number = (p #>> '{round,turnNumber}')::integer,
           turn_deadline = private.from_ms(p #> '{round,turnDeadline}'),
           public_state = p #> '{round,publicState}',
           last_event_seq = (p #>> '{round,lastEventSeq}')::integer,
           updated_at = now()
     where id = v_round_id;

    update public.round_player_private rp
       set private_state = x -> 'state', state_version = v_new, updated_at = now()
      from pg_catalog.jsonb_array_elements(coalesce(p -> 'privateStates', '[]'::jsonb)) as x
     where rp.round_id = v_round_id and rp.player_id = (x ->> 'playerId')::uuid;

    insert into public.round_events (round_id, seq, room_id, event)
    select v_round_id, (e ->> 'seq')::integer, v_room_id, e
    from pg_catalog.jsonb_array_elements(coalesce(p -> 'events', '[]'::jsonb)) as e;

    if v_end is not null and pg_catalog.jsonb_typeof(v_end) = 'object' then
      update public.rounds
         set winner = v_end ->> 'winner',
             end_reason = v_end ->> 'endReason',
             connector_player_id = (v_end ->> 'connectorId')::uuid,
             results_deadline = private.from_ms(v_end -> 'resultsDeadline'),
             ended_at = private.from_ms(v_end -> 'endedAt'),
             reveal = v_end -> 'reveal'
       where id = v_round_id;
      insert into public.score_entries (game_id, round_no, player_id, room_id, points, reason)
      select v_game.id, v_round.round_no, (s ->> 'playerId')::uuid, v_room_id,
             (s ->> 'points')::smallint, s ->> 'reason'
      from pg_catalog.jsonb_array_elements(coalesce(v_end -> 'scores', '[]'::jsonb)) as s;
      -- Secrets are no longer needed once the round is resolved (ARCHITECTURE §5).
      delete from private.round_secrets where round_id = v_round_id;
    end if;

    update public.room_players
       set status = 'LEFT', left_at = now(), is_ready = false
     where room_id = v_room_id and status = 'ACTIVE'
       and id = any (private.uuid_array(p -> 'leftPlayerIds'));
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      perform private.run_lobby_maintenance(v_room_id); -- host migration
      v_room_changed := true;
    end if;

    if p -> 'gameFinish' is not null and pg_catalog.jsonb_typeof(p -> 'gameFinish') = 'object' then
      update public.games
         set status = 'FINISHED', end_reason = p #>> '{gameFinish,endReason}',
             finished_at = now(), updated_at = now()
       where id = v_game.id;
      update public.rooms set status = 'FINISHED' where id = v_room_id;
      v_room_changed := true;
    end if;

    perform private.log_command(p, v_game.id, v_round_id, v_new, p -> 'response');
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'command_log_pkey' then
      return private.lobby_error('COMMAND_ID_REUSED');
    end if;
    raise;
  end;

  if v_room_changed then
    perform private.touch_room(v_room_id);
  end if;
  perform private.broadcast_game_changed(v_room_id, v_game.id, v_round_id, v_new);
  return pg_catalog.jsonb_build_object('ok', true, 'response', p -> 'response');
end;
$$;

-- START_NEXT_ROUND (or finishing the game when fewer than MIN_PLAYERS remain).
-- Authorization: the host at any time after the round ended; anyone after results_deadline.
create function public.game_persist_next_round(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_me public.room_players;
  v_game public.games;
  v_previous public.rounds;
  v_round_id uuid;
  v_version integer;
  v_response jsonb;
begin
  select * into v_room from public.rooms where id = (p ->> 'roomId')::uuid for update;
  select * into v_me from public.room_players
   where room_id = v_room.id and user_id = (p ->> 'userId')::uuid and status = 'ACTIVE';
  if v_room.id is null or v_me.id is null then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;
  select * into v_game from public.games
   where id = (p ->> 'gameId')::uuid and room_id = v_room.id for update;
  if not found or v_game.status <> 'IN_PROGRESS' then
    return private.lobby_error('GAME_NOT_IN_PROGRESS');
  end if;
  if v_game.current_round_no <> (p ->> 'previousRoundNo')::integer then
    return private.lobby_error('STALE_STATE');
  end if;
  select * into v_previous from public.rounds
   where game_id = v_game.id and round_no = v_game.current_round_no;
  if v_previous.phase <> 'ROUND_ENDED' then
    return private.lobby_error('ROUND_NOT_FINISHED');
  end if;
  if v_room.host_player_id is distinct from v_me.id and now() < v_previous.results_deadline then
    return private.lobby_error('RESULTS_NOT_EXPIRED');
  end if;

  if coalesce((p ->> 'finish')::boolean, false) then
    update public.games
       set status = 'FINISHED', end_reason = coalesce(p ->> 'endReason', 'INSUFFICIENT_PLAYERS'),
           finished_at = now(), updated_at = now()
     where id = v_game.id;
    update public.rooms set status = 'FINISHED' where id = v_room.id;
    v_response := coalesce(p -> 'response', '{}'::jsonb)
      || pg_catalog.jsonb_build_object('gameId', v_game.id, 'finished', true);
    perform private.log_command(p, v_game.id, v_previous.id, v_previous.state_version, v_response);
    perform private.touch_room(v_room.id);
    perform private.broadcast_game_changed(v_room.id, v_game.id, v_previous.id, v_previous.state_version);
    return pg_catalog.jsonb_build_object('ok', true, 'response', v_response);
  end if;

  if private.active_member_ids(v_room.id) <> private.uuid_array(p -> 'playerIds') then
    return private.lobby_error('STALE_STATE');
  end if;
  if (p #>> '{round,roundNo}')::integer <> v_game.current_round_no + 1
     or (p #>> '{round,roundNo}')::integer > v_game.total_rounds then
    return private.lobby_error('INVALID_REQUEST');
  end if;

  v_version := (p #>> '{round,version}')::integer;
  v_round_id := private.insert_round(
    v_game.id, v_room.id, p -> 'round', (p ->> 'rulesVersion')::integer, p ->> 'seed',
    p -> 'privateStates', p -> 'events');
  update public.games
     set current_round_no = current_round_no + 1, updated_at = now()
   where id = v_game.id;

  v_response := coalesce(p -> 'response', '{}'::jsonb)
    || pg_catalog.jsonb_build_object('gameId', v_game.id, 'roundId', v_round_id, 'version', v_version);
  perform private.log_command(p, v_game.id, v_round_id, v_version, v_response);
  perform private.broadcast_game_changed(v_room.id, v_game.id, v_round_id, v_version);
  return pg_catalog.jsonb_build_object('ok', true, 'response', v_response);
end;
$$;

-- LEAVE while the current round has ended (its secret state is already gone): the player simply
-- leaves the game; they are excluded from later rounds and score nothing more.
create function public.game_persist_leave_ended(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_me public.room_players;
  v_game public.games;
  v_round public.rounds;
begin
  select * into v_room from public.rooms where id = (p ->> 'roomId')::uuid for update;
  select * into v_me from public.room_players
   where room_id = v_room.id and user_id = (p ->> 'userId')::uuid and status = 'ACTIVE';
  if v_room.id is null or v_me.id is null then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;
  select * into v_game from public.games
   where room_id = v_room.id and status = 'IN_PROGRESS' for update;
  select * into v_round from public.rounds
   where game_id = v_game.id and round_no = v_game.current_round_no;
  if v_game.id is null or v_round.phase is distinct from 'ROUND_ENDED' then
    return private.lobby_error('STALE_STATE');
  end if;

  update public.room_players
     set status = 'LEFT', left_at = now(), is_ready = false
   where id = v_me.id;
  perform private.run_lobby_maintenance(v_room.id);
  perform private.log_command(p, v_game.id, v_round.id, v_round.state_version, p -> 'response');
  perform private.touch_room(v_room.id);
  perform private.broadcast_game_changed(v_room.id, v_game.id, v_round.id, v_round.state_version);
  return pg_catalog.jsonb_build_object('ok', true, 'response', p -> 'response');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Client read APIs (authenticated room members). Identity comes only from auth.uid().
-- ---------------------------------------------------------------------------------------------

-- PUBLIC game snapshot: no roles, hands, deck, set-aside role or unrevealed identities.
-- `reveal` is non-null only after the round ended (enforced by a table CHECK as well).
create function public.get_game_snapshot(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.rooms;
  v_game public.games;
  v_round public.rounds;
begin
  if v_user is null then
    return private.lobby_error('UNAUTHENTICATED');
  end if;
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.id is null or not exists (
    select 1 from public.room_players
    where room_id = v_room.id and user_id = v_user and status = 'ACTIVE'
  ) then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;
  select * into v_game from public.games where room_id = v_room.id order by created_at desc limit 1;
  if v_game.id is null then
    return private.lobby_error('GAME_NOT_STARTED');
  end if;
  select * into v_round from public.rounds
   where game_id = v_game.id and round_no = v_game.current_round_no;

  return pg_catalog.jsonb_build_object('ok', true, 'snapshot', pg_catalog.jsonb_build_object(
    'serverNow', private.to_ms(pg_catalog.clock_timestamp()),
    'game', pg_catalog.jsonb_build_object(
      'id', v_game.id, 'status', v_game.status, 'currentRoundNo', v_game.current_round_no,
      'totalRounds', v_game.total_rounds, 'endReason', v_game.end_reason),
    'round', pg_catalog.jsonb_build_object(
      'id', v_round.id, 'roundNo', v_round.round_no, 'phase', v_round.phase,
      'version', v_round.state_version, 'publicState', v_round.public_state,
      'resultsDeadline', private.to_ms(v_round.results_deadline),
      'result', case when v_round.phase = 'ROUND_ENDED' then pg_catalog.jsonb_build_object(
        'winner', v_round.winner, 'endReason', v_round.end_reason,
        'connectorPlayerId', v_round.connector_player_id) else null end,
      'reveal', case when v_round.phase = 'ROUND_ENDED' then v_round.reveal else null end),
    'players', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'playerId', m.id, 'seat', m.seat, 'displayName', m.display_name, 'status', m.status,
        'isMe', m.user_id = v_user, 'isHost', m.id = v_room.host_player_id,
        'connection', case
          when m.last_seen_at >= now() - interval '45 seconds' then 'CONNECTED'
          when m.last_seen_at >= now() - interval '120 seconds' then 'AWAY'
          else 'DISCONNECTED' end) order by m.seat)
      from public.room_players m
      where m.room_id = v_room.id
        and m.id in (
          select (x ->> 'playerId')::uuid
          from pg_catalog.jsonb_array_elements(v_round.public_state -> 'players') as x)), '[]'::jsonb),
    'scores', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'roundNo', s.round_no, 'playerId', s.player_id, 'points', s.points, 'reason', s.reason)
        order by s.round_no, s.player_id)
      from public.score_entries s where s.game_id = v_game.id), '[]'::jsonb),
    'events', coalesce((
      select pg_catalog.jsonb_agg(ev.event order by ev.seq)
      from (select e.event, e.seq from public.round_events e
            where e.round_id = v_round.id order by e.seq desc limit 30) as ev), '[]'::jsonb)
  ));
end;
$$;

-- PLAYER-PRIVATE state of the caller only (no player id parameter exists).
create function public.get_my_game_state(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_me public.room_players;
  v_game public.games;
  v_round public.rounds;
  v_private public.round_player_private;
begin
  if v_user is null then
    return private.lobby_error('UNAUTHENTICATED');
  end if;
  select * into v_me from public.room_players
   where room_id = p_room_id and user_id = v_user and status = 'ACTIVE';
  if not found then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;
  select * into v_game from public.games where room_id = p_room_id order by created_at desc limit 1;
  select * into v_round from public.rounds
   where game_id = v_game.id and round_no = v_game.current_round_no;
  select * into v_private from public.round_player_private
   where round_id = v_round.id and player_id = v_me.id;
  if v_private.round_id is null then
    return private.lobby_error('GAME_NOT_STARTED');
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'private', pg_catalog.jsonb_build_object(
    'gameId', v_game.id, 'roundId', v_round.id, 'roundNo', v_round.round_no,
    'version', v_private.state_version, 'playerId', v_me.id, 'state', v_private.private_state));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Execute privileges
-- ---------------------------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function
  public.create_room(text, integer),
  public.join_room(text, text),
  public.leave_room(uuid),
  public.set_ready(uuid, boolean),
  public.heartbeat(uuid),
  public.claim_host(uuid),
  public.update_room_settings(uuid, integer),
  public.kick_player(uuid, uuid),
  public.get_room_snapshot(text),
  public.get_my_active_room(),
  public.get_game_snapshot(uuid),
  public.get_my_game_state(uuid)
to authenticated;
grant execute on function private.can_access_room_topic(text) to authenticated;

-- Trusted server path only (Edge Function with the service-role key).
grant execute on function
  public.game_server_context(jsonb),
  public.game_persist_start(jsonb),
  public.game_persist_transition(jsonb),
  public.game_persist_next_round(jsonb),
  public.game_persist_leave_ended(jsonb)
to service_role;
