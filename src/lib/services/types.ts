import type {
  ActionTarget,
  PrivateEffect,
  PrivatePlayerView,
  PublicEvent,
  PublicRoundView,
  RoundEndReason,
  RoundRevealView,
  ScoreReason,
  WinnerFaction,
} from '../../domain/index.ts';

/**
 * Service boundary between the UI and the backend. Components and hooks depend on these
 * interfaces only; the Supabase implementation lives in supabaseServices.ts and tests inject
 * fakes. Shapes mirror the server's safe lobby read model (private.build_room_snapshot).
 */

export type RoomStatus = 'LOBBY' | 'IN_GAME' | 'FINISHED' | 'CLOSED';
export type ConnectionState = 'CONNECTED' | 'AWAY' | 'DISCONNECTED';

export interface LobbyPlayer {
  readonly playerId: string;
  readonly seat: number;
  readonly displayName: string;
  readonly isReady: boolean;
  readonly isHost: boolean;
  readonly isMe: boolean;
  readonly connection: ConnectionState;
}

export interface LobbySnapshot {
  readonly serverNow: number;
  readonly room: {
    readonly id: string;
    readonly code: string;
    readonly status: RoomStatus;
    readonly capacity: number;
    /** Increments on every lobby change; used to ignore stale notifications/responses. */
    readonly version: number;
    readonly hostPlayerId: string | null;
  };
  readonly me: {
    readonly playerId: string;
    readonly seat: number;
    readonly isHost: boolean;
    readonly isReady: boolean;
  };
  readonly players: readonly LobbyPlayer[];
  /** Server-decided start eligibility (the client never decides this). */
  readonly start: {
    readonly minPlayers: number;
    readonly playerCount: number;
    readonly notReadyCount: number;
    readonly canStart: boolean;
  };
}

export interface RoomRef {
  readonly roomId: string;
  readonly code: string;
}

export interface ActiveRoomRef extends RoomRef {
  readonly status: RoomStatus;
}

export interface LobbyApi {
  createRoom(input: { displayName: string; capacity: number }): Promise<RoomRef>;
  joinRoom(input: { code: string; displayName: string }): Promise<RoomRef>;
  getSnapshot(code: string): Promise<LobbySnapshot>;
  setReady(roomId: string, ready: boolean): Promise<LobbySnapshot>;
  leaveRoom(roomId: string): Promise<void>;
  heartbeat(roomId: string): Promise<{ roomVersion: number }>;
  updateCapacity(roomId: string, capacity: number): Promise<LobbySnapshot>;
  kickPlayer(roomId: string, playerId: string): Promise<LobbySnapshot>;
  getMyActiveRoom(): Promise<ActiveRoomRef | null>;
  /** Host only: FINISHED room → fresh LOBBY (play again). */
  resetRoom(roomId: string): Promise<LobbySnapshot>;
}

export interface SessionInfo {
  readonly userId: string;
  readonly isAnonymous: boolean;
}

export interface AuthGateway {
  /** Restores the locally persisted session (refreshing it if needed). Never creates a user. */
  getSession(): Promise<SessionInfo | null>;
  /** Creates a new anonymous user. Only called when no session exists. */
  signInAnonymously(): Promise<SessionInfo>;
  onSessionChange(listener: (session: SessionInfo | null) => void): () => void;
}

export type RealtimeStatus = 'CONNECTING' | 'SUBSCRIBED' | 'DISCONNECTED';

export interface RoomSubscriptionHandlers {
  /** "Something changed" notification carrying only the new room version. */
  readonly onRoomChanged: (roomVersion: number) => void;
  /** Gameplay notification: identifiers and version only, never game data. */
  readonly onGameChanged: (change: { readonly roundId: string; readonly version: number }) => void;
  readonly onStatus: (status: RealtimeStatus) => void;
}

export interface RealtimeGateway {
  subscribeToRoom(roomId: string, handlers: RoomSubscriptionHandlers): () => void;
}

// ---------------------------------------------------------------------------------------------
// Gameplay (authoritative Edge Function + member snapshot RPCs)
// ---------------------------------------------------------------------------------------------

export type GameCommandInput =
  | { readonly type: 'START_GAME' }
  | { readonly type: 'START_NEXT_ROUND' }
  | { readonly type: 'LEAVE' }
  | { readonly type: 'DISCARD'; readonly cardId: string }
  | {
      readonly type: 'PLAY_PATH';
      readonly cardId: string;
      readonly x: number;
      readonly y: number;
      readonly rotation: number;
    }
  | { readonly type: 'PLAY_ACTION'; readonly cardId: string; readonly target: ActionTarget }
  | { readonly type: 'RESOLVE_EXPIRED_TURN'; readonly expectedTurnNumber: number };

export interface CommandResponse {
  readonly ok: true;
  readonly commandType: string;
  readonly version?: number;
  readonly gameId?: string;
  readonly roundId?: string;
  /** The caller's own private effects only (e.g. a scout result). */
  readonly private?: readonly PrivateEffect[];
  readonly replayed?: boolean;
}

export interface GamePlayer {
  readonly playerId: string;
  readonly seat: number;
  readonly displayName: string;
  readonly status: 'ACTIVE' | 'LEFT' | 'REMOVED';
  readonly isMe: boolean;
  readonly isHost: boolean;
  readonly connection: ConnectionState;
}

/** PUBLIC game state (get_game_snapshot). */
export interface GameSnapshot {
  readonly serverNow: number;
  readonly game: {
    readonly id: string;
    readonly status: 'IN_PROGRESS' | 'FINISHED' | 'ABANDONED';
    readonly currentRoundNo: number;
    readonly totalRounds: number;
    readonly endReason: string | null;
  };
  readonly round: {
    readonly id: string;
    readonly roundNo: number;
    readonly phase: 'ROUND_ACTIVE' | 'ROUND_ENDED';
    readonly version: number;
    readonly publicState: PublicRoundView;
    readonly resultsDeadline: number | null;
    readonly result: {
      readonly winner: WinnerFaction;
      readonly endReason: RoundEndReason;
      readonly connectorPlayerId: string | null;
    } | null;
    readonly reveal: RoundRevealView | null;
  };
  readonly players: readonly GamePlayer[];
  readonly scores: readonly {
    readonly roundNo: number;
    readonly playerId: string;
    readonly points: number;
    readonly reason: ScoreReason;
  }[];
  readonly events: readonly PublicEvent[];
}

/** PLAYER-PRIVATE state of the caller (get_my_game_state). */
export interface MyGameState {
  readonly gameId: string;
  readonly roundId: string;
  readonly roundNo: number;
  readonly version: number;
  readonly playerId: string;
  readonly state: PrivatePlayerView;
}

export interface GameApi {
  sendCommand(input: {
    readonly roomId: string;
    readonly commandId: string;
    readonly expectedVersion?: number;
    readonly command: GameCommandInput;
  }): Promise<CommandResponse>;
  getSnapshot(roomId: string): Promise<GameSnapshot>;
  getMyState(roomId: string): Promise<MyGameState>;
}

export interface Services {
  readonly auth: AuthGateway;
  readonly lobby: LobbyApi;
  readonly game: GameApi;
  readonly realtime: RealtimeGateway;
}
