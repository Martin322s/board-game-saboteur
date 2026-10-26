import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toAppError, type AppError } from '../../lib/errors/appError.ts';
import { queryKeys } from '../../lib/query/keys.ts';
import { useServices } from '../../lib/services/ServicesContext.tsx';
import type {
  CommandResponse,
  GameCommandInput,
  GameSnapshot,
  MyGameState,
} from '../../lib/services/types.ts';

/**
 * Game server state: PUBLIC snapshot + the caller's PRIVATE state, fetched separately and only
 * shown together when both refer to the same round and state version (see GameView).
 */
const retryTransient = (failureCount: number, error: AppError) =>
  (error.code === 'NETWORK_ERROR' || error.code === 'UNKNOWN') && failureCount < 3;

export function useGameSnapshot(roomId: string, refetchInterval: number | false) {
  const { game } = useServices();
  return useQuery<GameSnapshot, AppError>({
    queryKey: queryKeys.gameSnapshot(roomId),
    queryFn: async () => {
      try {
        return await game.getSnapshot(roomId);
      } catch (error) {
        throw toAppError(error);
      }
    },
    refetchInterval,
    retry: retryTransient,
  });
}

export function useMyGameState(roomId: string) {
  const { game } = useServices();
  return useQuery<MyGameState, AppError>({
    queryKey: queryKeys.myGameState(roomId),
    queryFn: async () => {
      try {
        return await game.getMyState(roomId);
      } catch (error) {
        throw toAppError(error);
      }
    },
    retry: retryTransient,
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends one authoritative command. A fresh command id is generated per user action and REUSED
 * for automatic retries after network errors, so a retry can never apply twice (ARCHITECTURE
 * §9.3). Every outcome triggers a refetch: the server, not the response, is the source of truth.
 */
export function useGameCommand(roomId: string, roomCode: string) {
  const { game } = useServices();
  const queryClient = useQueryClient();
  return useMutation<
    CommandResponse,
    AppError,
    { command: GameCommandInput; expectedVersion?: number }
  >({
    mutationFn: async ({ command, expectedVersion }) => {
      const commandId = crypto.randomUUID();
      for (let attempt = 0; ; attempt++) {
        try {
          return await game.sendCommand({
            roomId,
            commandId,
            command,
            ...(expectedVersion === undefined ? {} : { expectedVersion }),
          });
        } catch (error) {
          const appError = toAppError(error);
          if (appError.code !== 'NETWORK_ERROR' || attempt >= 2) throw appError;
          await delay(400 * (attempt + 1));
        }
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.game(roomId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.roomSnapshot(roomCode) }),
      ]);
    },
  });
}
