import {
  FunctionsHttpError,
  type RealtimeChannel,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
import { RULES_VERSION } from '../../domain/index.ts';
import { AppError, appErrorFromServerCode, toAppError } from '../errors/appError.ts';
import type {
  ActiveRoomRef,
  AuthGateway,
  CommandResponse,
  GameApi,
  GameSnapshot,
  LobbyApi,
  LobbySnapshot,
  MyGameState,
  RealtimeGateway,
  RealtimeStatus,
  RoomRef,
  Services,
  SessionInfo,
} from './types.ts';

type RpcEnvelope = { readonly ok: true } & Record<string, unknown>;

/** Call a lobby RPC and unwrap its `{ ok, error }` envelope into a value or an AppError. */
async function callRpc(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<RpcEnvelope> {
  let response: Awaited<ReturnType<SupabaseClient['rpc']>>;
  try {
    response = await client.rpc(fn, args);
  } catch (error) {
    throw toAppError(error);
  }
  if (response.error) throw toAppError(response.error);
  const data: unknown = response.data;
  if (typeof data !== 'object' || data === null) throw new AppError('UNKNOWN');
  const envelope = data as { ok?: unknown; error?: unknown };
  if (envelope.ok !== true) throw appErrorFromServerCode(envelope.error);
  return data as RpcEnvelope;
}

const snapshotOf = (envelope: RpcEnvelope): LobbySnapshot => envelope.snapshot as LobbySnapshot;
const roomRefOf = (envelope: RpcEnvelope): RoomRef => ({
  roomId: String(envelope.roomId),
  code: String(envelope.code),
});

function createLobbyApi(client: SupabaseClient): LobbyApi {
  return {
    createRoom: async ({ displayName, capacity }) =>
      roomRefOf(
        await callRpc(client, 'create_room', { p_display_name: displayName, p_capacity: capacity }),
      ),
    joinRoom: async ({ code, displayName }) =>
      roomRefOf(await callRpc(client, 'join_room', { p_code: code, p_display_name: displayName })),
    getSnapshot: async (code) =>
      snapshotOf(await callRpc(client, 'get_room_snapshot', { p_code: code })),
    setReady: async (roomId, ready) =>
      snapshotOf(await callRpc(client, 'set_ready', { p_room_id: roomId, p_ready: ready })),
    leaveRoom: async (roomId) => {
      await callRpc(client, 'leave_room', { p_room_id: roomId });
    },
    heartbeat: async (roomId) => {
      const envelope = await callRpc(client, 'heartbeat', { p_room_id: roomId });
      return { roomVersion: Number(envelope.roomVersion) };
    },
    updateCapacity: async (roomId, capacity) =>
      snapshotOf(
        await callRpc(client, 'update_room_settings', { p_room_id: roomId, p_capacity: capacity }),
      ),
    kickPlayer: async (roomId, playerId) =>
      snapshotOf(
        await callRpc(client, 'kick_player', { p_room_id: roomId, p_player_id: playerId }),
      ),
    resetRoom: async (roomId) =>
      snapshotOf(await callRpc(client, 'reset_room', { p_room_id: roomId })),
    getMyActiveRoom: async () => {
      const envelope = await callRpc(client, 'get_my_active_room');
      return (envelope.room ?? null) as ActiveRoomRef | null;
    },
  };
}

function createGameApi(client: SupabaseClient): GameApi {
  return {
    async sendCommand({ roomId, commandId, expectedVersion, command }) {
      const { data, error } = await client.functions.invoke('game-command', {
        body: {
          roomId,
          commandId,
          command,
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        },
        // Version handshake: the server rejects outdated bundles with CLIENT_OUTDATED.
        headers: { 'x-rules-version': String(RULES_VERSION) },
      });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const body = (await (error.context as Response).json().catch(() => null)) as {
            error?: unknown;
          } | null;
          throw appErrorFromServerCode(body?.error);
        }
        throw toAppError(error);
      }
      const envelope = data as { ok?: unknown; error?: unknown } | null;
      if (envelope?.ok !== true) throw appErrorFromServerCode(envelope?.error);
      return data as CommandResponse;
    },
    getSnapshot: async (roomId) =>
      (await callRpc(client, 'get_game_snapshot', { p_room_id: roomId })).snapshot as GameSnapshot,
    getMyState: async (roomId) =>
      (await callRpc(client, 'get_my_game_state', { p_room_id: roomId })).private as MyGameState,
  };
}

const sessionInfo = (user: User): SessionInfo => ({
  userId: user.id,
  isAnonymous: user.is_anonymous === true,
});

function createAuthGateway(client: SupabaseClient): AuthGateway {
  return {
    async getSession() {
      const { data, error } = await client.auth.getSession();
      // A retryable (network) error keeps the stored session intact; surface it instead of
      // treating the user as signed out, so we never mint a replacement identity by mistake.
      if (error) throw toAppError(error);
      return data.session ? sessionInfo(data.session.user) : null;
    },
    async signInAnonymously() {
      const { data, error } = await client.auth.signInAnonymously();
      if (error) throw toAppError(error);
      if (!data.user) throw new AppError('UNKNOWN');
      return sessionInfo(data.user);
    },
    onSessionChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        // Must stay synchronous: awaiting Supabase calls inside this callback can deadlock.
        listener(session ? sessionInfo(session.user) : null);
      });
      return () => data.subscription.unsubscribe();
    },
  };
}

function toRealtimeStatus(status: string): RealtimeStatus {
  if (status === 'SUBSCRIBED') return 'SUBSCRIBED';
  if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    return 'DISCONNECTED';
  }
  return 'CONNECTING';
}

function createRealtimeGateway(client: SupabaseClient): RealtimeGateway {
  return {
    subscribeToRoom(roomId, { onRoomChanged, onGameChanged, onStatus }) {
      let channel: RealtimeChannel | null = null;
      let cancelled = false;
      onStatus('CONNECTING');

      // Private channel: the server authorizes membership via RLS on realtime.messages.
      void client.realtime
        .setAuth()
        .catch(() => undefined)
        .then(() => {
          if (cancelled) return;
          channel = client
            .channel(`room:${roomId}`, { config: { private: true } })
            .on('broadcast', { event: 'room_changed' }, (message) => {
              const payload = message.payload as { roomVersion?: unknown } | undefined;
              onRoomChanged(Number(payload?.roomVersion));
            })
            .on('broadcast', { event: 'game_changed' }, (message) => {
              const payload = message.payload as
                { roundId?: unknown; version?: unknown } | undefined;
              onGameChanged({
                roundId: String(payload?.roundId ?? ''),
                version: Number(payload?.version),
              });
            })
            .subscribe((status) => {
              if (!cancelled) onStatus(toRealtimeStatus(status));
            });
        });

      return () => {
        cancelled = true;
        if (channel) void client.removeChannel(channel);
      };
    },
  };
}

export function createSupabaseServices(client: SupabaseClient): Services {
  return {
    auth: createAuthGateway(client),
    lobby: createLobbyApi(client),
    game: createGameApi(client),
    realtime: createRealtimeGateway(client),
  };
}
