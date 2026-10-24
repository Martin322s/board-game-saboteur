import type { Board } from '../board/board.ts';
import { canonicalHandOrder, type HandCard } from '../hands/hand.ts';
import type {
  DestinationIdentity,
  EpochMs,
  PlayerId,
  Role,
  Seat,
  StateVersion,
} from '../primitives.ts';
import type { ToolState } from '../tools/tools.ts';
import { isAfk } from '../turns/turnOrder.ts';
import type { KnownDestination, RoundPhase, RoundResult, RoundState } from './types.ts';

/**
 * Information-class projections (SECURITY_MODEL §1). These are the ONLY shapes that may leave
 * the authoritative server. Each is built field by field (never by spreading secret state) so
 * that new secret fields cannot leak by accident.
 */

export interface PublicPlayerView {
  readonly playerId: PlayerId;
  readonly seat: Seat;
  readonly handCount: number;
  readonly tools: ToolState;
  readonly hasLeft: boolean;
  readonly isAfk: boolean;
}

/** PUBLIC ROOM STATE for the round. */
export interface PublicRoundView {
  readonly rulesVersion: number;
  readonly roundNo: number;
  readonly phase: RoundPhase;
  readonly version: StateVersion;
  readonly turnNumber: number;
  readonly activePlayerId: PlayerId | null;
  readonly turnStartedAt: EpochMs;
  readonly turnDeadline: EpochMs | null;
  readonly drawPileCount: number;
  readonly discardCount: number;
  /** Placed paths + destinations; identities only for revealed slots. */
  readonly board: Board;
  readonly players: readonly PublicPlayerView[];
  readonly lastEventSeq: number;
  /** Winner/end reason once ended (no roles; those are in the reveal). */
  readonly result: RoundResult | null;
}

/** PLAYER-PRIVATE STATE. */
export interface PrivatePlayerView {
  readonly playerId: PlayerId;
  readonly role: Role;
  /** Canonical order (ascending handPosition). */
  readonly hand: readonly HandCard[];
  readonly knownDestinations: readonly KnownDestination[];
}

/** ROUND-REVEALED STATE: only available once the round has ended. */
export interface RoundRevealView {
  readonly roles: readonly { readonly playerId: PlayerId; readonly role: Role }[];
  readonly setAsideRole: Role;
  readonly destinations: readonly DestinationIdentity[];
}

export function projectPublic(state: RoundState): PublicRoundView {
  return {
    rulesVersion: state.rulesVersion,
    roundNo: state.roundNo,
    phase: state.phase,
    version: state.version,
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId,
    turnStartedAt: state.turnStartedAt,
    turnDeadline: state.turnDeadline,
    drawPileCount: state.drawPile.length,
    discardCount: state.discardPile.length,
    board: {
      paths: state.board.paths,
      destinations: state.board.destinations.map((d) => ({
        slot: d.slot,
        x: d.x,
        y: d.y,
        revealed: d.revealed,
      })),
    },
    players: state.players.map((p) => ({
      playerId: p.playerId,
      seat: p.seat,
      handCount: p.hand.cards.length,
      tools: p.tools,
      hasLeft: p.hasLeft,
      isAfk: isAfk(p.consecutiveTimeouts),
    })),
    lastEventSeq: state.lastEventSeq,
    result: state.result,
  };
}

/** Returns null when the player is not part of the round. */
export function projectPrivate(state: RoundState, playerId: PlayerId): PrivatePlayerView | null {
  const player = state.players.find((p) => p.playerId === playerId);
  if (!player) return null;
  return {
    playerId: player.playerId,
    role: player.role,
    hand: canonicalHandOrder(player.hand.cards),
    knownDestinations: player.knownDestinations,
  };
}

export function projectReveal(state: RoundState): RoundRevealView | null {
  if (state.phase !== 'ROUND_ENDED') return null;
  return {
    roles: state.players.map((p) => ({ playerId: p.playerId, role: p.role })),
    setAsideRole: state.setAsideRole,
    destinations: [...state.destinationIdentities],
  };
}
