import type { Board } from '../board/board.ts';
import type { CardInstance } from '../cards/types.ts';
import type { HandState } from '../hands/hand.ts';
import type {
  DestinationIdentity,
  DestinationSlot,
  EpochMs,
  PlayerId,
  Role,
  Seat,
  StateVersion,
} from '../primitives.ts';
import type { RoundOutcome } from '../scoring/scoring.ts';
import type { ToolState } from '../tools/tools.ts';

/**
 * The full AUTHORITATIVE round state. Contains secrets (roles, hands, deck order, destination
 * identities) and must only ever be held server-side. Clients receive projections
 * (see projections.ts). Plain JSON: no Map/Set/Date/class instances.
 */

export type RoundPhase = 'ROUND_ACTIVE' | 'ROUND_ENDED';

export interface KnownDestination {
  readonly slot: DestinationSlot;
  readonly identity: DestinationIdentity;
}

export interface RoundPlayer {
  readonly playerId: PlayerId;
  readonly seat: Seat;
  readonly role: Role;
  readonly hand: HandState;
  readonly tools: ToolState;
  readonly hasLeft: boolean;
  /** Reset by any successful command from this player; AFK when ≥ AFK_THRESHOLD. */
  readonly consecutiveTimeouts: number;
  /** Private scout results, ascending by slot. */
  readonly knownDestinations: readonly KnownDestination[];
}

export interface DiscardEntry {
  readonly card: CardInstance;
  /** Played action cards and collapsed paths are public; plain discards/timeouts are not. */
  readonly faceUp: boolean;
}

export interface RoundResult extends RoundOutcome {
  readonly endedAt: EpochMs;
  readonly resultsDeadline: EpochMs;
}

export interface RoundState {
  readonly rulesVersion: number;
  readonly roundNo: number;
  readonly phase: RoundPhase;
  readonly version: StateVersion;
  /** Seat ascending. */
  readonly players: readonly RoundPlayer[];
  readonly setAsideRole: Role;
  /** SECRET. Index = destination slot. */
  readonly destinationIdentities: readonly DestinationIdentity[];
  readonly board: Board;
  /** Index 0 = top. */
  readonly drawPile: readonly CardInstance[];
  readonly discardPile: readonly DiscardEntry[];
  readonly startingSeat: Seat;
  readonly activePlayerId: PlayerId | null;
  readonly turnNumber: number;
  readonly turnStartedAt: EpochMs;
  /** null once the round has ended. */
  readonly turnDeadline: EpochMs | null;
  readonly lastEventSeq: number;
  readonly result: RoundResult | null;
}
