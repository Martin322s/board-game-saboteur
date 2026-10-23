-- =============================================================================================
-- Lobby RPCs and private helpers (ARCHITECTURE §4.5, §6; SECURITY_MODEL §2.3).
--
-- Conventions:
--   * Public RPCs are SECURITY DEFINER with `search_path = ''` and fully qualified names.
--   * Identity comes only from auth.uid(); no RPC accepts a caller/player id for the actor.
--   * Every RPC that touches a room locks the room row first (FOR UPDATE), serializing all
--     lobby mutations of that room.
--   * Expected failures are RETURNED as {"ok": false, "error": "<CODE>"} rather than raised, so
--     the transaction commits: rate-limit counters and lazy cleanup persist even when the
--     request itself is rejected (otherwise failed brute-force joins would never be counted).
--     All validation happens before any mutation of the requested change.
--   * Unexpected failures still raise and roll back.
--   * Lazy maintenance (stale members, host migration, closing empty rooms) runs inside lobby
--     RPCs. Lobby correctness never depends on a scheduler (ARCHITECTURE §8.2).
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------------------------

create function private.lobby_error(p_code text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('ok', false, 'error', p_code)
$$;

-- Fixed-window limiter. Returns false when the caller exceeded `p_limit` hits in `p_window`.
create function private.consume_rate_limit(p_user uuid, p_action text, p_limit integer, p_window interval)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_hits integer;
begin
  insert into private.rate_limits as rl (user_id, action, window_start, hits)
  values (p_user, p_action, now(), 1)
  on conflict (user_id, action) do update
    set window_start = case when rl.window_start <= now() - p_window then now() else rl.window_start end,
        hits = case when rl.window_start <= now() - p_window then 1 else rl.hits + 1 end
  returning rl.hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- Trim, NFC-normalize and collapse internal whitespace.
create function private.normalize_display_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(normalize(coalesce(p_name, ''), NFC), '^\s+|\s+$', '', 'g'),
           '\s+', ' ', 'g')
$$;

-- 2–20 characters: Latin (incl. Latin-1/Extended), Greek, Cyrillic letters, ASCII digits,
-- space and . _ -  (PRODUCT_SPEC §4). An allowlist, so control and bidi characters are rejected.
-- Mirrored in src/features/lobby/validation.ts for UX only.
create function private.is_valid_display_name(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name is not null
     and pg_catalog.char_length(p_name) between 2 and 20
     and p_name ~ '^[A-Za-z0-9À-ÖØ-öø-ɏΆ-ώЀ-ҁҊ-ӿ ._-]+$'
$$;

create function private.normalize_room_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_code, ''), '[[:space:]-]', '', 'g'))
$$;

create function private.is_valid_room_code(p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'
$$;

-- Uniform 6-character code from a CSPRNG (rejection sampling avoids modulo bias).
create function private.generate_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text := '';
  v_bytes bytea;
  v_byte integer;
  v_i integer;
begin
  while pg_catalog.char_length(v_code) < 6 loop
    v_bytes := extensions.gen_random_bytes(8);
    for v_i in 0..7 loop
      v_byte := pg_catalog.get_byte(v_bytes, v_i);
      -- 248 = 31 * 8: bytes below it map uniformly onto the 31-character alphabet.
      if v_byte < 248 and pg_catalog.char_length(v_code) < 6 then
        v_code := v_code || pg_catalog.substr(v_alphabet, (v_byte % 31) + 1, 1);
      end if;
    end loop;
  end loop;
  return v_code;
end;
$$;

-- Membership check for policies (SECURITY DEFINER avoids RLS recursion; returns only a boolean).
create function private.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_players p
    where p.room_id = p_room_id
      and p.user_id = (select auth.uid())
      and p.status = 'ACTIVE'
  )
$$;

-- Realtime Authorization helper: topic must be exactly 'room:<uuid>' of a room the caller is in.
create function private.can_access_room_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_topic is null
     or p_topic !~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.is_room_member(pg_catalog.substr(p_topic, 6)::uuid);
end;
$$;

-- Memberships that still matter for the per-user cap: active games, and lobby seats that are
-- not stale (stale lobby seats are removed lazily by their own room's next lobby action).
create function private.live_membership_count(p_user uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select pg_catalog.count(*)::integer
  from public.room_players p
  join public.rooms r on r.id = p.room_id
  where p.user_id = p_user
    and p.status = 'ACTIVE'
    and (r.status = 'IN_GAME'
         or (r.status = 'LOBBY' and p.last_seen_at >= now() - interval '120 seconds'))
$$;

-- Deterministic host election (ARCHITECTURE §6): lowest seat among ACTIVE members seen within
-- 45 s; if none, lowest seat among ACTIVE members; NULL if the room is empty.
-- Returns true when the host changed.
create function private.elect_host(p_room_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  select r.host_player_id into v_old from public.rooms r where r.id = p_room_id;
  select p.id into v_new
  from public.room_players p
  where p.room_id = p_room_id and p.status = 'ACTIVE'
  order by (p.last_seen_at >= now() - interval '45 seconds') desc, p.seat asc
  limit 1;
  if v_new is not distinct from v_old then
    return false;
  end if;
  update public.rooms set host_player_id = v_new where id = p_room_id;
  return true;
end;
$$;

-- Lazy lobby maintenance. Caller must hold the room row lock. Returns true if anything changed.
--   * LOBBY: ACTIVE members not seen for > 120 s are REMOVED.
--   * Host missing, inactive, or not seen for > 60 s: re-elect.
--   * LOBBY/FINISHED room with no ACTIVE members: CLOSED.
create function private.run_lobby_maintenance(p_room_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_host public.room_players;
  v_rows integer;
  v_changed boolean := false;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if not found or v_room.status = 'CLOSED' then
    return false;
  end if;

  if v_room.status = 'LOBBY' then
    update public.room_players
       set status = 'REMOVED', left_at = now(), is_ready = false
     where room_id = p_room_id
       and status = 'ACTIVE'
       and last_seen_at < now() - interval '120 seconds';
    get diagnostics v_rows = row_count;
    v_changed := v_rows > 0;
  end if;

  select * into v_host from public.room_players where id = v_room.host_player_id;
  if v_host.id is null
     or v_host.status <> 'ACTIVE'
     or v_host.last_seen_at < now() - interval '60 seconds' then
    if private.elect_host(p_room_id) then
      v_changed := true;
    end if;
  end if;

  if v_room.status in ('LOBBY', 'FINISHED')
     and not exists (
       select 1 from public.room_players where room_id = p_room_id and status = 'ACTIVE'
     ) then
    update public.rooms
       set status = 'CLOSED', closed_at = now(), host_player_id = null
     where id = p_room_id;
    v_changed := true;
  end if;

  return v_changed;
end;
$$;

-- Marks a player as seen now. Returns true if they had been away (> 45 s), i.e. other members
-- should be told about the reconnect.
create function private.touch_player(p_player_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_previous timestamptz;
begin
  select last_seen_at into v_previous from public.room_players where id = p_player_id;
  update public.room_players set last_seen_at = now() where id = p_player_id;
  return v_previous < now() - interval '45 seconds';
end;
$$;

-- Notification only: payload carries the new version, never room data (ARCHITECTURE §7).
-- Broadcast failure must not fail the lobby operation (clients also poll as a fallback).
create function private.broadcast_room_changed(p_room_id uuid, p_version bigint)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform realtime.send(
    pg_catalog.jsonb_build_object('roomVersion', p_version),
    'room_changed',
    'room:' || p_room_id::text,
    true
  );
exception when others then
  raise warning 'room_changed broadcast failed for room %: %', p_room_id, sqlerrm;
end;
$$;

-- Bump the room version and notify subscribers. Returns the new version.
create function private.touch_room(p_room_id uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_version bigint;
begin
  update public.rooms
     set room_version = room_version + 1, updated_at = now()
   where id = p_room_id
  returning room_version into v_version;
  perform private.broadcast_room_changed(p_room_id, v_version);
  return v_version;
end;
$$;

-- Safe lobby read model. Contains no auth ids and no gameplay data.
create function private.build_room_snapshot(p_room_id uuid, p_user uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with room as (
    select r.* from public.rooms r where r.id = p_room_id
  ),
  members as (
    select p.id, p.user_id, p.seat, p.display_name, p.is_ready, p.last_seen_at,
           (p.id = room.host_player_id) as is_host
    from public.room_players p
    join room on p.room_id = room.id
    where p.status = 'ACTIVE'
  ),
  counts as (
    select pg_catalog.count(*)::integer as player_count,
           (pg_catalog.count(*) filter (where not m.is_host and not m.is_ready))::integer as not_ready_count
    from members m
  )
  select pg_catalog.jsonb_build_object(
    'serverNow', pg_catalog.floor(extract(epoch from now()) * 1000)::bigint,
    'room', pg_catalog.jsonb_build_object(
      'id', room.id,
      'code', room.code,
      'status', room.status,
      'capacity', room.capacity,
      'version', room.room_version,
      'hostPlayerId', room.host_player_id
    ),
    'me', (
      select pg_catalog.jsonb_build_object(
        'playerId', m.id, 'seat', m.seat, 'isHost', m.is_host, 'isReady', m.is_ready)
      from members m where m.user_id = p_user
    ),
    'players', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'playerId', m.id,
        'seat', m.seat,
        'displayName', m.display_name,
        'isReady', m.is_ready,
        'isHost', m.is_host,
        'isMe', m.user_id = p_user,
        'connection', case
          when m.last_seen_at >= now() - interval '45 seconds' then 'CONNECTED'
          when m.last_seen_at >= now() - interval '120 seconds' then 'AWAY'
          else 'DISCONNECTED'
        end
      ) order by m.seat)
      from members m
    ), '[]'::jsonb),
    -- Start eligibility is decided here, never by the client (ARCHITECTURE §4.2 guard).
    'start', pg_catalog.jsonb_build_object(
      'minPlayers', 3,
      'playerCount', counts.player_count,
      'notReadyCount', counts.not_ready_count,
      'canStart', room.status = 'LOBBY'
                  and counts.player_count >= 3
                  and counts.player_count <= room.capacity
                  and counts.not_ready_count = 0
    )
  )
  from room, counts
$$;

-- ---------------------------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------------------------

create function public.create_room(p_display_name text, p_capacity integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := private.normalize_display_name(p_display_name);
  v_room_id uuid;
  v_code text;
  v_player_id uuid;
  v_attempt integer := 0;
begin
  if v_user is null then
    return private.lobby_error('UNAUTHENTICATED');
  end if;
  if not private.consume_rate_limit(v_user, 'create_room', 5, interval '10 minutes') then
    return private.lobby_error('RATE_LIMITED');
  end if;
  if not private.is_valid_display_name(v_name) then
    return private.lobby_error('INVALID_NAME');
  end if;
  if p_capacity is null or p_capacity not between 3 and 10 then
    return private.lobby_error('INVALID_CAPACITY');
  end if;
  if private.live_membership_count(v_user) >= 3 then
    return private.lobby_error('TOO_MANY_ROOMS');
  end if;

  -- Retry on the (rare) collision with another open room's code.
  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.rooms (code, capacity)
      values (private.generate_room_code(), p_capacity)
      returning id, code into v_room_id, v_code;
      exit;
    exception when unique_violation then
      if v_attempt >= 10 then
        raise;
      end if;
    end;
  end loop;

  insert into public.room_players (room_id, user_id, display_name, name_key, seat)
  values (v_room_id, v_user, v_name, pg_catalog.lower(v_name), 0)
  returning id into v_player_id;

  update public.rooms set host_player_id = v_player_id where id = v_room_id;

  return pg_catalog.jsonb_build_object('ok', true, 'roomId', v_room_id, 'code', v_code);
end;
$$;

create function public.join_room(p_code text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code text := private.normalize_room_code(p_code);
  v_name text := private.normalize_display_name(p_display_name);
  v_room public.rooms;
  v_me public.room_players;
  v_changed boolean;
  v_count integer;
  v_seat integer;
begin
  if v_user is null then
    return private.lobby_error('UNAUTHENTICATED');
  end if;
  if not private.consume_rate_limit(v_user, 'join_room', 20, interval '10 minutes') then
    return private.lobby_error('RATE_LIMITED');
  end if;
  if not private.is_valid_room_code(v_code) then
    return private.lobby_error('ROOM_NOT_FOUND');
  end if;

  select * into v_room from public.rooms where code = v_code and status <> 'CLOSED' for update;
  if not found then
    return private.lobby_error('ROOM_NOT_FOUND');
  end if;

  -- Idempotent: an existing member (refresh, second tab) keeps their seat and name.
  select * into v_me
  from public.room_players
  where room_id = v_room.id and user_id = v_user and status = 'ACTIVE';
  if found then
    if private.touch_player(v_me.id) then
      perform private.touch_room(v_room.id);
    end if;
    return pg_catalog.jsonb_build_object('ok', true, 'roomId', v_room.id, 'code', v_room.code);
  end if;

  if v_room.status = 'IN_GAME' then
    return private.lobby_error('GAME_IN_PROGRESS');
  end if;
  if v_room.status <> 'LOBBY' then
    return private.lobby_error('ROOM_NOT_JOINABLE');
  end if;
  if not private.is_valid_display_name(v_name) then
    return private.lobby_error('INVALID_NAME');
  end if;
  if private.live_membership_count(v_user) >= 3 then
    return private.lobby_error('TOO_MANY_ROOMS');
  end if;

  v_changed := private.run_lobby_maintenance(v_room.id);

  -- Maintenance may have closed an abandoned room.
  select * into v_room from public.rooms where id = v_room.id;
  if v_room.status <> 'LOBBY' then
    return private.lobby_error('ROOM_NOT_FOUND');
  end if;

  select pg_catalog.count(*) into v_count
  from public.room_players where room_id = v_room.id and status = 'ACTIVE';
  if v_count >= v_room.capacity then
    if v_changed then
      perform private.touch_room(v_room.id);
    end if;
    return private.lobby_error('ROOM_FULL');
  end if;

  if exists (
    select 1 from public.room_players
    where room_id = v_room.id and status = 'ACTIVE' and name_key = pg_catalog.lower(v_name)
  ) then
    if v_changed then
      perform private.touch_room(v_room.id);
    end if;
    return private.lobby_error('NAME_TAKEN');
  end if;

  select pg_catalog.min(s) into v_seat
  from pg_catalog.generate_series(0, v_room.capacity - 1) as s
  where not exists (
    select 1 from public.room_players p
    where p.room_id = v_room.id and p.status = 'ACTIVE' and p.seat = s
  );

  insert into public.room_players (room_id, user_id, display_name, name_key, seat)
  values (v_room.id, v_user, v_name, pg_catalog.lower(v_name), v_seat);

  perform private.run_lobby_maintenance(v_room.id); -- elects a host if the seat was vacant
  perform private.touch_room(v_room.id);
  return pg_catalog.jsonb_build_object('ok', true, 'roomId', v_room.id, 'code', v_room.code);
end;
$$;

create function public.leave_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.rooms;
  v_me public.room_players;
begin
  if v_user is null then
    return private.lobby_error('UNAUTHENTICATED');
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;
  select * into v_me
  from public.room_players
  where room_id = v_room.id and user_id = v_user and status = 'ACTIVE';
  if not found then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;
  -- Leaving a running game is a gameplay command (Edge LEAVE), added with the game iteration.
  if v_room.status = 'IN_GAME' then
    return private.lobby_error('GAME_IN_PROGRESS');
  end if;

  update public.room_players
     set status = 'LEFT', left_at = now(), is_ready = false
   where id = v_me.id;

  perform private.run_lobby_maintenance(v_room.id); -- host migration / close empty room
  perform private.touch_room(v_room.id);
  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

create function public.set_ready(p_room_id uuid, p_ready boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.rooms;
  v_me public.room_players;
  v_changed boolean;
  v_rows integer;
begin
  if v_user is null then
    return private.lobby_error('UNAUTHENTICATED');
  end if;
  if p_ready is null then
    return private.lobby_error('INVALID_REQUEST');
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;
  select * into v_me
  from public.room_players
  where room_id = v_room.id and user_id = v_user and status = 'ACTIVE';
  if not found then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;

  v_changed := private.touch_player(v_me.id);
  v_changed := private.run_lobby_maintenance(v_room.id) or v_changed;
  select * into v_room from public.rooms where id = v_room.id;

  if v_room.status <> 'LOBBY' then
    if v_changed then
      perform private.touch_room(v_room.id);
    end if;
    return private.lobby_error('NOT_IN_LOBBY');
  end if;
  -- The host has no ready flag: starting the game implies readiness (ARCHITECTURE §6).
  if v_room.host_player_id = v_me.id then
    if v_changed then
      perform private.touch_room(v_room.id);
    end if;
    return private.lobby_error('HOST_CANNOT_READY');
  end if;

  -- Only the caller's own row can change; there is no target parameter.
  update public.room_players set is_ready = p_ready where id = v_me.id and is_ready <> p_ready;
  get diagnostics v_rows = row_count;
  if v_changed or v_rows > 0 then
    perform private.touch_room(v_room.id);
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'snapshot', private.build_room_snapshot(v_room.id, v_user));
end;
$$;

-- Liveness ping (15 s while visible, 60 s while hidden). Also drives lazy maintenance so stale
-- members and hosts are handled without a scheduler.
create function public.heartbeat(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.rooms;
  v_me public.room_players;
  v_changed boolean;
  v_version bigint;
begin
  if v_user is null then
    return private.lobby_error('UNAUTHENTICATED');
  end if;
  if not private.consume_rate_limit(v_user, 'heartbeat', 10, interval '1 minute') then
    return private.lobby_error('RATE_LIMITED');
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;
  select * into v_me
  from public.room_players
  where room_id = v_room.id and user_id = v_user and status = 'ACTIVE';
  if not found then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;

  v_changed := private.touch_player(v_me.id);
  v_changed := private.run_lobby_maintenance(v_room.id) or v_changed;
  v_version := v_room.room_version;
  if v_changed then
    v_version := private.touch_room(v_room.id);
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'roomVersion', v_version);
end;
$$;

-- Explicit host re-election request (ARCHITECTURE §4.5). The rule is deterministic, so the
-- caller's identity does not influence the result.
create function public.claim_host(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.rooms;
begin
  if v_user is null then
    return private.lobby_error('UNAUTHENTICATED');
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or not exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = v_user and status = 'ACTIVE'
  ) then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;
  if private.run_lobby_maintenance(p_room_id) then
    perform private.touch_room(p_room_id);
  end if;
  select * into v_room from public.rooms where id = p_room_id;
  return pg_catalog.jsonb_build_object('ok', true, 'hostPlayerId', v_room.host_player_id);
end;
$$;

create function public.update_room_settings(p_room_id uuid, p_capacity integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.rooms;
  v_me public.room_players;
  v_player public.room_players;
  v_changed boolean;
  v_count integer;
  v_seat integer;
begin
  if v_user is null then
    return private.lobby_error('UNAUTHENTICATED');
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;
  select * into v_me
  from public.room_players
  where room_id = v_room.id and user_id = v_user and status = 'ACTIVE';
  if not found then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;

  v_changed := private.touch_player(v_me.id);
  v_changed := private.run_lobby_maintenance(v_room.id) or v_changed;
  select * into v_room from public.rooms where id = v_room.id;

  if v_room.status <> 'LOBBY' then
    if v_changed then perform private.touch_room(v_room.id); end if;
    return private.lobby_error('NOT_IN_LOBBY');
  end if;
  if v_room.host_player_id is distinct from v_me.id then
    if v_changed then perform private.touch_room(v_room.id); end if;
    return private.lobby_error('NOT_HOST');
  end if;
  if p_capacity is null or p_capacity not between 3 and 10 then
    if v_changed then perform private.touch_room(v_room.id); end if;
    return private.lobby_error('INVALID_CAPACITY');
  end if;
  select pg_catalog.count(*) into v_count
  from public.room_players where room_id = v_room.id and status = 'ACTIVE';
  if p_capacity < v_count then
    if v_changed then perform private.touch_room(v_room.id); end if;
    return private.lobby_error('CAPACITY_BELOW_PLAYERS');
  end if;

  -- Shrinking: move players on seats >= new capacity to the lowest free seats (seat order is
  -- only turn order; no game is running in the lobby).
  for v_player in
    select * from public.room_players
    where room_id = v_room.id and status = 'ACTIVE' and seat >= p_capacity
    order by seat
  loop
    select pg_catalog.min(s) into v_seat
    from pg_catalog.generate_series(0, p_capacity - 1) as s
    where not exists (
      select 1 from public.room_players p
      where p.room_id = v_room.id and p.status = 'ACTIVE' and p.seat = s
    );
    update public.room_players set seat = v_seat where id = v_player.id;
  end loop;

  update public.rooms set capacity = p_capacity where id = v_room.id;
  perform private.touch_room(v_room.id);
  return pg_catalog.jsonb_build_object(
    'ok', true, 'snapshot', private.build_room_snapshot(v_room.id, v_user));
end;
$$;

create function public.kick_player(p_room_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.rooms;
  v_me public.room_players;
  v_changed boolean;
  v_rows integer;
begin
  if v_user is null then
    return private.lobby_error('UNAUTHENTICATED');
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;
  select * into v_me
  from public.room_players
  where room_id = v_room.id and user_id = v_user and status = 'ACTIVE';
  if not found then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;

  v_changed := private.touch_player(v_me.id);
  v_changed := private.run_lobby_maintenance(v_room.id) or v_changed;
  select * into v_room from public.rooms where id = v_room.id;

  if v_room.status <> 'LOBBY' then
    if v_changed then perform private.touch_room(v_room.id); end if;
    return private.lobby_error('NOT_IN_LOBBY');
  end if;
  if v_room.host_player_id is distinct from v_me.id then
    if v_changed then perform private.touch_room(v_room.id); end if;
    return private.lobby_error('NOT_HOST');
  end if;

  update public.room_players
     set status = 'REMOVED', left_at = now(), is_ready = false
   where id = p_player_id and room_id = v_room.id and status = 'ACTIVE' and id <> v_me.id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    if v_changed then perform private.touch_room(v_room.id); end if;
    return private.lobby_error('INVALID_TARGET');
  end if;

  perform private.touch_room(v_room.id);
  return pg_catalog.jsonb_build_object(
    'ok', true, 'snapshot', private.build_room_snapshot(v_room.id, v_user));
end;
$$;

-- Read model for the room route. Unknown codes and non-membership are indistinguishable
-- (no room enumeration).
create function public.get_room_snapshot(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room_id uuid;
begin
  if v_user is null then
    return private.lobby_error('UNAUTHENTICATED');
  end if;
  select r.id into v_room_id
  from public.rooms r
  where r.code = private.normalize_room_code(p_code) and r.status <> 'CLOSED';
  if v_room_id is null or not exists (
    select 1 from public.room_players p
    where p.room_id = v_room_id and p.user_id = v_user and p.status = 'ACTIVE'
  ) then
    return private.lobby_error('NOT_ROOM_MEMBER');
  end if;
  return pg_catalog.jsonb_build_object(
    'ok', true, 'snapshot', private.build_room_snapshot(v_room_id, v_user));
end;
$$;

-- Reconnect discovery (ARCHITECTURE §9.2): the caller's most recently active open membership.
create function public.get_my_active_room()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if v_user is null then
    return private.lobby_error('UNAUTHENTICATED');
  end if;
  select pg_catalog.jsonb_build_object('roomId', r.id, 'code', r.code, 'status', r.status)
    into v_result
  from public.room_players p
  join public.rooms r on r.id = p.room_id
  where p.user_id = v_user and p.status = 'ACTIVE' and r.status <> 'CLOSED'
  order by p.last_seen_at desc
  limit 1;
  return pg_catalog.jsonb_build_object('ok', true, 'room', v_result);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Execute privileges: deny by default, then grant the lobby RPCs to authenticated only.
-- Anonymous Supabase users are `authenticated`; the `anon` role (no session) gets nothing.
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
  public.get_my_active_room()
to authenticated;

grant execute on function private.can_access_room_topic(text) to authenticated;
