import type { CardId, EpochMs, PlayerId, StateVersion, Tool } from '../primitives.ts';

/**
 * Command intents (ARCHITECTURE §3.2, §4.5). The actor is NEVER part of the payload: the
 * authoritative layer derives it from the authenticated session and passes it separately.
 *
 * Numeric/enum fields are typed loosely on purpose where values arrive from untrusted JSON;
 * the domain validates them (e.g. rotation, slot, coordinates).
 */
export type ActionTarget =
  | { readonly kind: 'PLAYER'; readonly playerId: PlayerId; readonly tool?: Tool }
  | { readonly kind: 'DESTINATION'; readonly slot: number }
  | { readonly kind: 'CELL'; readonly x: number; readonly y: number };

export type GameCommand =
  | {
      readonly type: 'PLAY_PATH';
      readonly cardId: CardId;
      readonly x: number;
      readonly y: number;
      readonly rotation: number;
    }
  | { readonly type: 'PLAY_ACTION'; readonly cardId: CardId; readonly target: ActionTarget }
  | { readonly type: 'DISCARD'; readonly cardId: CardId }
  | { readonly type: 'RESOLVE_EXPIRED_TURN'; readonly expectedTurnNumber: number }
  | { readonly type: 'LEAVE' };

export type GameCommandType = GameCommand['type'];

export interface CommandContext {
  /** Authoritative server time. */
  readonly now: EpochMs;
  /**
   * Client's last-seen state version. When provided, a mismatch yields STALE_STATE
   * (for RESOLVE_EXPIRED_TURN only after the turn/deadline checks, per GAME_RULES §8.5).
   */
  readonly expectedVersion?: StateVersion;
}
