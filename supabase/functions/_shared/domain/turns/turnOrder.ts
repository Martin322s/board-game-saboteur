import { AFK_THRESHOLD, AFK_TURN_TIMEOUT_MS, TURN_TIMEOUT_MS } from '../config/timing.ts';
import type { PlayerId, Seat } from '../primitives.ts';

export interface TurnCandidate {
  readonly playerId: PlayerId;
  readonly seat: Seat;
  readonly hasLeft: boolean;
  readonly handCount: number;
}

function bySeat<T extends { readonly seat: Seat }>(players: readonly T[]): T[] {
  return [...players].sort((a, b) => a.seat - b.seat);
}

/**
 * GAME_RULES §8.4: starting after `currentSeat`, step through seats ascending with wrap-around
 * (ending with `currentSeat` itself) and pick the first non-left player holding at least one
 * card. Returns null when nobody qualifies.
 */
export function nextEligiblePlayer(
  players: readonly TurnCandidate[],
  currentSeat: Seat,
): PlayerId | null {
  const ordered = bySeat(players);
  const after = ordered.filter((p) => p.seat > currentSeat);
  const upTo = ordered.filter((p) => p.seat <= currentSeat);
  const next = [...after, ...upTo].find((p) => !p.hasLeft && p.handCount > 0);
  return next?.playerId ?? null;
}

/** GAME_RULES §2.3 step 6, rounds > 1: first seat strictly after the previous starting seat. */
export function seatAfter(seats: readonly Seat[], previous: Seat): Seat {
  const sorted = [...seats].sort((a, b) => a - b);
  const next = sorted.find((s) => s > previous) ?? sorted[0];
  if (next === undefined) throw new RangeError('seatAfter needs at least one seat');
  return next;
}

export function isAfk(consecutiveTimeouts: number): boolean {
  return consecutiveTimeouts >= AFK_THRESHOLD;
}

export function turnTimeoutMs(consecutiveTimeouts: number): number {
  return isAfk(consecutiveTimeouts) ? AFK_TURN_TIMEOUT_MS : TURN_TIMEOUT_MS;
}
