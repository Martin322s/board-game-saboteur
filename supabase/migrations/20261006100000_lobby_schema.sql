-- =============================================================================================
-- Lobby foundation: schema, constraints, grants, RLS (RELEASE_PLAN iteration 4, lobby subset).
--
-- Security stance (SECURITY_MODEL §2):
--   * RLS enabled on every table; NO direct table privileges for anon/authenticated.
--   * Every read and write goes through explicitly granted RPCs (next migration).
--   * Internal helpers and bookkeeping live in the `private` schema, which the Data API does not
--     expose.
--   * No gameplay secrets exist in this schema yet (no games/rounds/hands/roles tables).
-- =============================================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
-- authenticated needs USAGE only so the Realtime authorization policy can call the single
-- granted helper `private.can_access_room_topic`. No other private object is granted.
grant usage on schema private to authenticated;

-- Future objects created by this role must not silently become client-accessible.
-- Note: PostgreSQL's built-in EXECUTE-to-PUBLIC default for new functions is global, so every
-- migration must still revoke function EXECUTE explicitly; the pgTAP suite fails if any
-- function in public/private is executable by anon or by authenticated unexpectedly.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  status text not null default 'LOBBY',
  capacity smallint not null,
  host_player_id uuid,
  room_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  -- 6 characters, no 0/O/1/I/L (PRODUCT_SPEC §4).
  constraint rooms_code_format check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),
  constraint rooms_status_valid check (status in ('LOBBY', 'IN_GAME', 'FINISHED', 'CLOSED')),
  constraint rooms_capacity_range check (capacity between 3 and 10),
  constraint rooms_closed_at_consistent check ((status = 'CLOSED') = (closed_at is not null)),
  constraint rooms_version_positive check (room_version > 0)
);

-- Codes are unique among rooms that are not closed (closed rooms are purged later).
create unique index rooms_code_open_key on public.rooms (code) where status <> 'CLOSED';

comment on table public.rooms is
  'Lobby rooms. No client privileges; read through get_room_snapshot(), written by lobby RPCs.';

-- ---------------------------------------------------------------------------------------------
-- room_players (memberships)
-- ---------------------------------------------------------------------------------------------
create table public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  -- Case-folded display name used for per-room uniqueness.
  name_key text not null,
  seat smallint not null,
  is_ready boolean not null default false,
  status text not null default 'ACTIVE',
  joined_at timestamptz not null default now(),
  -- Server-controlled; updated only by lobby RPCs (heartbeat and every lobby action).
  last_seen_at timestamptz not null default now(),
  left_at timestamptz,
  constraint room_players_id_room_key unique (id, room_id),
  constraint room_players_status_valid check (status in ('ACTIVE', 'LEFT', 'REMOVED')),
  constraint room_players_seat_range check (seat between 0 and 9),
  constraint room_players_name_length check (char_length(display_name) between 2 and 20),
  constraint room_players_name_key_consistent check (name_key = lower(display_name)),
  constraint room_players_left_at_consistent check ((status = 'ACTIVE') = (left_at is null))
);

-- One active membership per identity per room, one active player per seat, unique names.
create unique index room_players_active_user_key
  on public.room_players (room_id, user_id) where status = 'ACTIVE';
create unique index room_players_active_seat_key
  on public.room_players (room_id, seat) where status = 'ACTIVE';
create unique index room_players_active_name_key
  on public.room_players (room_id, name_key) where status = 'ACTIVE';
create index room_players_user_active_idx
  on public.room_players (user_id) where status = 'ACTIVE';

comment on table public.room_players is
  'Room memberships. user_id is never returned to clients. No client privileges.';

-- The host must be a player of the same room (composite FK; NULL only for closed rooms).
alter table public.rooms
  add constraint rooms_host_player_fk
  foreign key (host_player_id, id) references public.room_players (id, room_id)
  deferrable initially deferred;

-- ---------------------------------------------------------------------------------------------
-- Capacity invariant, enforced structurally:
--   0 <= seat < capacity for every ACTIVE player  +  unique (room, seat) among ACTIVE players
--   => at most `capacity` active players, even under concurrent inserts.
-- ---------------------------------------------------------------------------------------------
create function private.enforce_seat_within_capacity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_capacity smallint;
begin
  if new.status <> 'ACTIVE' then
    return new;
  end if;
  select r.capacity into v_capacity from public.rooms r where r.id = new.room_id;
  if new.seat >= v_capacity then
    raise exception 'seat % is outside room capacity %', new.seat, v_capacity
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger room_players_seat_within_capacity
  before insert or update of seat, status on public.room_players
  for each row execute function private.enforce_seat_within_capacity();

create function private.enforce_capacity_covers_seats()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.room_players p
    where p.room_id = new.id and p.status = 'ACTIVE' and p.seat >= new.capacity
  ) then
    raise exception 'capacity % would exclude an occupied seat', new.capacity
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger rooms_capacity_covers_seats
  before update of capacity on public.rooms
  for each row execute function private.enforce_capacity_covers_seats();

-- ---------------------------------------------------------------------------------------------
-- Rate limiting (SECURITY_MODEL T17/T18). One row per (user, action): bounded growth.
-- ---------------------------------------------------------------------------------------------
create table private.rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (user_id, action),
  constraint rate_limits_hits_positive check (hits > 0)
);

-- ---------------------------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------------------------
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table private.rate_limits enable row level security;

-- Supabase grants table privileges to anon/authenticated by default; remove them all.
-- RLS stays enabled with no policies as a second layer.
revoke all on table public.rooms, public.room_players from public, anon, authenticated;
revoke all on table private.rate_limits from public, anon, authenticated;
