import { RESULTS_AUTO_ADVANCE_MS } from '../config/timing.ts';
import type { DestinationIdentity, EpochMs } from '../primitives.ts';
import { scoreRound, type RoundOutcome, type ScoreEntry } from '../scoring/scoring.ts';
import type { RoundState } from './types.ts';

/**
 * Exhaustion (GAME_RULES §9.2): the draw pile is empty AND every non-left player has an empty
 * hand. There is deliberately no "no possible move" heuristic.
 */
export function isExhausted(state: RoundState): boolean {
  return (
    state.drawPile.length === 0 &&
    state.players.every((p) => p.hasLeft || p.hand.cards.length === 0)
  );
}

/** Treasure reached (GAME_RULES §9.1): any newly revealed destination is the TREASURE. */
export function revealsTreasure(revealed: readonly DestinationIdentity[]): boolean {
  return revealed.includes('TREASURE');
}

export function activePlayerCount(state: RoundState): number {
  return state.players.filter((p) => !p.hasLeft).length;
}

/** Round resolution (GAME_RULES §9.4 steps 1 and 4). Reveal is a projection; see projections.ts. */
export function endRound(state: RoundState, outcome: RoundOutcome, now: EpochMs): RoundState {
  return {
    ...state,
    phase: 'ROUND_ENDED',
    activePlayerId: null,
    turnDeadline: null,
    result: { ...outcome, endedAt: now, resultsDeadline: now + RESULTS_AUTO_ADVANCE_MS },
  };
}

/** Score an ended round. Players who left before resolution score 0. */
export function scoreEndedRound(state: RoundState): ScoreEntry[] {
  if (!state.result) throw new Error('scoreEndedRound called on an active round');
  return scoreRound(state.players, state.result);
}
