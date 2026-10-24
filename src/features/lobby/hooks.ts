import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toAppError, type AppError } from '../../lib/errors/appError.ts';
import { queryKeys } from '../../lib/query/keys.ts';
import { useServices } from '../../lib/services/ServicesContext.tsx';
import type { LobbySnapshot } from '../../lib/services/types.ts';
import { useAuth } from '../session/AuthProvider.tsx';

/**
 * Lobby server state lives only in TanStack Query. Mutations and realtime notifications both
 * converge on the same snapshot query; versions guard against out-of-order responses.
 */

export function setSnapshotIfNewer(
  queryClient: QueryClient,
  code: string,
  next: LobbySnapshot,
): void {
  queryClient.setQueryData<LobbySnapshot>(queryKeys.roomSnapshot(code), (current) =>
    current && current.room.version > next.room.version ? current : next,
  );
}

export function useRoomSnapshot(
  code: string,
  options: { readonly enabled: boolean; readonly refetchInterval: number | false },
) {
  const { lobby } = useServices();
  return useQuery<LobbySnapshot, AppError>({
    queryKey: queryKeys.roomSnapshot(code),
    queryFn: async () => {
      try {
        return await lobby.getSnapshot(code);
      } catch (error) {
        throw toAppError(error);
      }
    },
    enabled: options.enabled,
    refetchInterval: options.refetchInterval,
    retry: (failureCount, error) =>
      error.code === 'NETWORK_ERROR' || error.code === 'UNKNOWN' ? failureCount < 3 : false,
  });
}

export function useMyActiveRoom() {
  const { lobby } = useServices();
  const { state } = useAuth();
  const userId = state.status === 'READY' ? state.userId : '';
  return useQuery({
    queryKey: queryKeys.myActiveRoom(userId),
    queryFn: () => lobby.getMyActiveRoom(),
    // Only for an existing session: never create an anonymous user just to check this.
    enabled: state.status === 'READY',
    retry: false,
  });
}

export function useCreateRoom() {
  const { lobby } = useServices();
  const { ensureSession } = useAuth();
  return useMutation({
    mutationFn: async (input: { displayName: string; capacity: number }) => {
      await ensureSession();
      return lobby.createRoom(input);
    },
  });
}

export function useJoinRoom() {
  const { lobby } = useServices();
  const { ensureSession } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { code: string; displayName: string }) => {
      await ensureSession();
      return lobby.joinRoom(input);
    },
    onSuccess: (room) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.roomSnapshot(room.code) }),
  });
}

export function useSetReady(code: string) {
  const { lobby } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, ready }: { roomId: string; ready: boolean }) =>
      lobby.setReady(roomId, ready),
    onSuccess: (snapshot) => setSnapshotIfNewer(queryClient, code, snapshot),
  });
}

export function useUpdateCapacity(code: string) {
  const { lobby } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, capacity }: { roomId: string; capacity: number }) =>
      lobby.updateCapacity(roomId, capacity),
    onSuccess: (snapshot) => setSnapshotIfNewer(queryClient, code, snapshot),
  });
}

export function useKickPlayer(code: string) {
  const { lobby } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, playerId }: { roomId: string; playerId: string }) =>
      lobby.kickPlayer(roomId, playerId),
    onSuccess: (snapshot) => setSnapshotIfNewer(queryClient, code, snapshot),
  });
}

/** Play again: the server returns the finished room to a fresh lobby (host only). */
export function useResetRoom(code: string) {
  const { lobby } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => lobby.resetRoom(roomId),
    onSuccess: (snapshot) => setSnapshotIfNewer(queryClient, code, snapshot),
  });
}

export function useLeaveRoom(code: string) {
  const { lobby } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => lobby.leaveRoom(roomId),
    onSuccess: () => queryClient.removeQueries({ queryKey: queryKeys.roomSnapshot(code) }),
  });
}
