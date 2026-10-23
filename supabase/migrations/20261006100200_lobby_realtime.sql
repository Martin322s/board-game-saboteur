-- =============================================================================================
-- Realtime Authorization for private room channels (ARCHITECTURE §7, SECURITY_MODEL T14).
--
--   * Topic: 'room:<room uuid>'. Only ACTIVE members of that room may RECEIVE broadcasts.
--   * There is deliberately NO insert policy: clients cannot broadcast or track presence on room
--     channels. Only the server (private.broadcast_room_changed) sends, and payloads carry a
--     version number only.
--   * No game/lobby tables are added to the supabase_realtime publication, so Postgres Changes
--     cannot stream rows.
--
-- realtime.messages is provisioned by the Realtime service. If it is missing, no policy is
-- created, and private channels fail closed (nobody can join).
-- =============================================================================================

do $$
begin
  if pg_catalog.to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages not found; room channel policy not created';
    return;
  end if;

  execute 'drop policy if exists "room members receive room broadcasts" on realtime.messages';
  execute $policy$
    create policy "room members receive room broadcasts"
      on realtime.messages
      for select
      to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and private.can_access_room_topic((select realtime.topic()))
      )
  $policy$;
end;
$$;
