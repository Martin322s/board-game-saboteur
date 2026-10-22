import { MIN_PLAYERS, ROUNDS_PER_GAME } from '../config/players.ts';

export type AfterRoundDecision = 'START_NEXT_ROUND' | 'FINISH_GAME';

/**
 * What happens after a round ends (GAME_RULES §9.3, §9.4 step 5): the game finishes after
 * ROUNDS_PER_GAME rounds, or early when fewer than MIN_PLAYERS non-left players remain.
 */
export function decideAfterRound(roundNo: number, remainingPlayers: number): AfterRoundDecision {
  return roundNo >= ROUNDS_PER_GAME || remainingPlayers < MIN_PLAYERS
    ? 'FINISH_GAME'
    : 'START_NEXT_ROUND';
}
