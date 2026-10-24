import {
  CONNECTOR_BONUS_POINTS,
  DISRUPTOR_WIN_POINTS,
  MINER_WIN_POINTS,
  SOLE_DISRUPTOR_WIN_POINTS,
} from '../config/scoring.ts';
import type { PlayerId, Role, Seat } from '../primitives.ts';

export type WinnerFaction = Role | 'NONE';
export type RoundEndReason = 'TREASURE_REACHED' | 'EXHAUSTED' | 'INSUFFICIENT_PLAYERS';

export interface RoundOutcome {
  readonly winner: WinnerFaction;
  readonly endReason: RoundEndReason;
  /** Actor whose placement revealed the treasure (TREASURE_REACHED only). */
  readonly connectorId: PlayerId | null;
}

export interface ScoringPlayer {
  readonly playerId: PlayerId;
  readonly role: Role;
  /** Left at or before the moment the round was resolved. */
  readonly hasLeft: boolean;
}

export type ScoreReason =
  | 'MINERS_WON'
  | 'MINERS_WON_CONNECTOR'
  | 'DISRUPTORS_WON'
  | 'DISRUPTORS_WON_SOLE'
  | 'LOST'
  | 'LEFT'
  | 'NO_WINNER';

export interface ScoreEntry {
  readonly playerId: PlayerId;
  readonly points: number;
  readonly reason: ScoreReason;
}

/**
 * Per-round points (GAME_RULES §10.1). Returns one entry per player (including 0-point entries)
 * in input order.
 */
export function scoreRound(players: readonly ScoringPlayer[], outcome: RoundOutcome): ScoreEntry[] {
  const disruptorsDealt = players.filter((p) => p.role === 'DISRUPTOR').length;

  return players.map((p): ScoreEntry => {
    if (outcome.winner === 'NONE') return { playerId: p.playerId, points: 0, reason: 'NO_WINNER' };
    if (p.hasLeft) return { playerId: p.playerId, points: 0, reason: 'LEFT' };
    if (p.role !== outcome.winner) return { playerId: p.playerId, points: 0, reason: 'LOST' };

    if (outcome.winner === 'MINER') {
      return outcome.connectorId === p.playerId
        ? {
            playerId: p.playerId,
            points: MINER_WIN_POINTS + CONNECTOR_BONUS_POINTS,
            reason: 'MINERS_WON_CONNECTOR',
          }
        : { playerId: p.playerId, points: MINER_WIN_POINTS, reason: 'MINERS_WON' };
    }
    return disruptorsDealt === 1
      ? { playerId: p.playerId, points: SOLE_DISRUPTOR_WIN_POINTS, reason: 'DISRUPTORS_WON_SOLE' }
      : { playerId: p.playerId, points: DISRUPTOR_WIN_POINTS, reason: 'DISRUPTORS_WON' };
  });
}

export interface StandingPlayer {
  readonly playerId: PlayerId;
  readonly seat: Seat;
  readonly hasLeft: boolean;
}

export interface Standing extends StandingPlayer {
  readonly total: number;
  readonly roundsWon: number;
  /** Standard competition ranking: 1, 2, 2, 4. */
  readonly rank: number;
}

/**
 * Final/running leaderboard (GAME_RULES §10.2–10.3): total desc, then rounds won desc; still-tied
 * players share a rank. Seat ascending is a display-only tie-break.
 */
export function computeStandings(
  players: readonly StandingPlayer[],
  rounds: readonly (readonly ScoreEntry[])[],
): Standing[] {
  const rows = players.map((p) => {
    const entries = rounds.flatMap((round) => round.filter((e) => e.playerId === p.playerId));
    return {
      ...p,
      total: entries.reduce((sum, e) => sum + e.points, 0),
      roundsWon: entries.filter((e) => e.points > 0).length,
    };
  });

  rows.sort((a, b) => b.total - a.total || b.roundsWon - a.roundsWon || a.seat - b.seat);

  return rows.map((row) => ({
    ...row,
    rank:
      1 +
      rows.filter(
        (other) =>
          other.total > row.total || (other.total === row.total && other.roundsWon > row.roundsWon),
      ).length,
  }));
}
