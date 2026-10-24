import type { RoundState } from '../domain/index.ts';

/**
 * Persistence boundary for the authoritative game pipeline. The production implementation calls
 * the service-role-only SQL functions (supabase/migrations/*_game_schema.sql) through an
 * injected RPC caller, so the same store runs in the Deno Edge Function (supabase-js) and in
 * Node integration tests (direct Postgres connection as `service_role`).
 */

export type ServerFailure = {
  readonly ok: false;
  readonly error: string;
  readonly currentVersion?: number;
};

export interface ServerContext {
  readonly ok: true;
  /** Database clock (epoch ms): the only time source for deadlines. */
  readonly serverNow: number;
  readonly me: { readonly playerId: string; readonly seat: number; readonly isHost: boolean };
  readonly room: {
    readonly id: string;
    readonly status: 'LOBBY' | 'IN_GAME' | 'FINISHED' | 'CLOSED';
    readonly version: number;
    readonly hostPlayerId: string | null;
  };
  /** ACTIVE members, seat ascending. */
  readonly members: readonly {
    readonly playerId: string;
    readonly seat: number;
    readonly isReady: boolean;
  }[];
  readonly loggedCommand: {
    readonly userId: string;
    readonly roomId: string;
    readonly fingerprint: string;
    readonly response: Record<string, unknown>;
  } | null;
  readonly game: {
    readonly id: string;
    readonly status: 'IN_PROGRESS' | 'FINISHED' | 'ABANDONED';
    readonly currentRoundNo: number;
    readonly totalRounds: number;
  } | null;
  readonly round: {
    readonly id: string;
    readonly roundNo: number;
    readonly phase: 'ROUND_ACTIVE' | 'ROUND_ENDED';
    readonly version: number;
    readonly turnNumber: number;
    readonly startingSeat: number;
    readonly resultsDeadline: number | null;
  } | null;
  /** SERVER-ONLY authoritative state; null once the round has ended. */
  readonly secret: { readonly version: number; readonly state: RoundState } | null;
}

export type ContextResult = ServerContext | ServerFailure;

export type PersistResult =
  { readonly ok: true; readonly response: Record<string, unknown> } | ServerFailure;

export interface ContextRequest {
  readonly userId: string;
  readonly roomId: string;
  readonly commandId: string;
  readonly rateLimit: boolean;
}

/** Payload pieces shared by all persistence calls (command log + idempotency). */
export interface CommandMeta {
  readonly userId: string;
  readonly roomId: string;
  readonly commandId: string;
  readonly commandType: string;
  readonly fingerprint: string;
  readonly expectedVersion: number | null;
  readonly response: Record<string, unknown>;
}

export interface RoundPayload {
  readonly roundNo: number;
  readonly version: number;
  readonly phase: string;
  readonly activePlayerId: string | null;
  readonly turnNumber: number;
  readonly turnDeadline: number | null;
  readonly startingSeat: number;
  readonly lastEventSeq: number;
  readonly publicState: unknown;
  readonly state: RoundState;
}

export interface NewRoundPayload extends CommandMeta {
  readonly playerIds: readonly string[];
  readonly rulesVersion: number;
  readonly seed: string;
  readonly round: RoundPayload;
  readonly privateStates: readonly { readonly playerId: string; readonly state: unknown }[];
  readonly events: readonly unknown[];
}

export interface TransitionPayload extends CommandMeta {
  readonly gameId: string;
  readonly roundId: string;
  readonly round: RoundPayload;
  readonly privateStates: readonly { readonly playerId: string; readonly state: unknown }[];
  readonly events: readonly unknown[];
  readonly roundEnd: Record<string, unknown> | null;
  readonly gameFinish: { readonly endReason: string } | null;
  readonly leftPlayerIds: readonly string[];
}

export type NextRoundPayload =
  | (CommandMeta & {
      readonly gameId: string;
      readonly previousRoundNo: number;
      readonly finish: true;
      readonly endReason: string;
    })
  | (NewRoundPayload & {
      readonly gameId: string;
      readonly previousRoundNo: number;
      readonly finish: false;
    });

export interface GameStore {
  loadContext(request: ContextRequest): Promise<ContextResult>;
  persistStart(payload: NewRoundPayload): Promise<PersistResult>;
  persistTransition(payload: TransitionPayload): Promise<PersistResult>;
  persistNextRound(payload: NextRoundPayload): Promise<PersistResult>;
  persistLeaveEnded(payload: CommandMeta): Promise<PersistResult>;
}

/** Calls `public.<fn>(p jsonb)` with trusted (service-role) credentials and returns its JSON. */
export type RpcCaller = (fn: string, payload: unknown) => Promise<unknown>;

export function createRpcGameStore(rpc: RpcCaller): GameStore {
  return {
    loadContext: async (request) => (await rpc('game_server_context', request)) as ContextResult,
    persistStart: async (payload) => (await rpc('game_persist_start', payload)) as PersistResult,
    persistTransition: async (payload) =>
      (await rpc('game_persist_transition', payload)) as PersistResult,
    persistNextRound: async (payload) =>
      (await rpc('game_persist_next_round', payload)) as PersistResult,
    persistLeaveEnded: async (payload) =>
      (await rpc('game_persist_leave_ended', payload)) as PersistResult,
  };
}
