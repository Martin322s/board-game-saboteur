import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toAppError } from '../../lib/errors/appError.ts';
import { queryKeys } from '../../lib/query/keys.ts';
import { useServices } from '../../lib/services/ServicesContext.tsx';
import type { GameSnapshot, LobbySnapshot, RealtimeStatus } from '../../lib/services/types.ts';

export const HEARTBEAT_VISIBLE_MS = 15_000;
export const HEARTBEAT_HIDDEN_MS = 60_000;

/**
 * Keeps a room snapshot fresh (ARCHITECTURE §7, §9.2):
 *  - Realtime "room_changed" pings invalidate the snapshot when they carry a newer version.
 *    Duplicate/older pings are ignored; missed pings are covered by refetch-on-(re)subscribe,
 *    refetch on visibility/online, and the polling interval chosen by the caller.
 *  - Heartbeats keep last_seen_at fresh (15 s visible, 60 s hidden) and let the server run lazy
 *    lobby maintenance. A network blip never removes the seat; only > 120 s of silence does.
 */
export function useRoomLiveness(roomId: string | undefined, code: string) {
  const { lobby, realtime } = useServices();
  const queryClient = useQueryClient();
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('CONNECTING');
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    if (!roomId) return;
    const key = queryKeys.roomSnapshot(code);
    const refetch = () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: queryKeys.game(roomId) });
    };
    const isNewerGame = (roundId: string, version: number) => {
      const current = queryClient.getQueryData<GameSnapshot>(queryKeys.gameSnapshot(roomId));
      return (
        !current ||
        current.round.id !== roundId ||
        !Number.isFinite(version) ||
        version > current.round.version
      );
    };
    const isNewer = (version: number) => {
      const current = queryClient.getQueryData<LobbySnapshot>(key);
      return !current || !Number.isFinite(version) || version > current.room.version;
    };

    const unsubscribe = realtime.subscribeToRoom(roomId, {
      onRoomChanged: (version) => {
        if (isNewer(version)) void queryClient.invalidateQueries({ queryKey: key });
      },
      onGameChanged: ({ roundId, version }) => {
        if (isNewerGame(roundId, version)) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.game(roomId) });
        }
      },
      onStatus: (status) => {
        setRealtimeStatus(status);
        // (Re)subscribed: anything may have happened while we were not listening.
        if (status === 'SUBSCRIBED') refetch();
      },
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const beat = async () => {
      try {
        const { roomVersion } = await lobby.heartbeat(roomId);
        if (isNewer(roomVersion)) refetch();
      } catch (error) {
        const code = toAppError(error).code;
        if (code === 'NOT_ROOM_MEMBER') refetch();
      }
    };
    const schedule = () => {
      if (disposed) return;
      clearTimeout(timer);
      timer = setTimeout(
        () => void beat().finally(schedule),
        document.visibilityState === 'hidden' ? HEARTBEAT_HIDDEN_MS : HEARTBEAT_VISIBLE_MS,
      );
    };
    const wake = () => {
      void beat();
      refetch();
      schedule();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') wake();
      else schedule();
    };
    const onOnline = () => {
      setOnline(true);
      wake();
    };
    const onOffline = () => setOnline(false);

    void beat();
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [roomId, code, lobby, realtime, queryClient]);

  return { realtimeStatus, online };
}
