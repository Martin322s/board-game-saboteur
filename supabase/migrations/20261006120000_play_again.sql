-- =============================================================================================
-- Play again (ARCHITECTURE §4.2: FINISHED → LOBBY via reset_room, host only, ready flags reset).
--
-- The finished game, its rounds and scores stay as history; their secrets were already deleted
-- when each round ended. The room returns to LOBBY with the same code and the same ACTIVE
-- members (players who left stay LEFT). A new START_GAME creates a brand-new game with freshly
-- dealt roles and hands.
-- =============================================================================================

create function public.reset_room(p_room_id uuid)
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
  v_changed := private.run_lobby_maintenance(v_room.id) or v_changed; -- host migration
  select * into v_room from public.rooms where id = v_room.id;

  if v_room.status <> 'FINISHED'
     or exists (select 1 from public.games where room_id = v_room.id and status = 'IN_PROGRESS') then
    if v_changed then perform private.touch_room(v_room.id); end if;
    return private.lobby_error('GAME_NOT_FINISHED');
  end if;
  if v_room.host_player_id is distinct from v_me.id then
    if v_changed then perform private.touch_room(v_room.id); end if;
    return private.lobby_error('NOT_HOST');
  end if;

  update public.rooms set status = 'LOBBY' where id = v_room.id;
  update public.room_players set is_ready = false where room_id = v_room.id and status = 'ACTIVE';

  perform private.touch_room(v_room.id);
  return pg_catalog.jsonb_build_object(
    'ok', true, 'snapshot', private.build_room_snapshot(v_room.id, v_user));
end;
$$;

revoke execute on function public.reset_room(uuid) from public, anon, authenticated;
grant execute on function public.reset_room(uuid) to authenticated;
