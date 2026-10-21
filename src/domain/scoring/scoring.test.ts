import { describe, expect, it } from 'vitest';
import type { Role } from '../primitives.ts';
import { computeStandings, scoreRound, type RoundOutcome } from './scoring.ts';

const players = (...roles: (Role | `${Role}!left`)[]) =>
  roles.map((r, i) => ({
    playerId: `p${i}`,
    role: r.replace('!left', '') as Role,
    hasLeft: r.endsWith('!left'),
  }));

const points = (ps: ReturnType<typeof players>, outcome: RoundOutcome) =>
  scoreRound(ps, outcome).map((e) => e.points);

const minersWin = (connectorId: string | null): RoundOutcome => ({
  winner: 'MINER',
  endReason: 'TREASURE_REACHED',
  connectorId,
});
const disruptorsWin: RoundOutcome = {
  winner: 'DISRUPTOR',
  endReason: 'EXHAUSTED',
  connectorId: null,
};

describe('round scoring', () => {
  it('miners win: 2 each, +1 for a miner connector', () => {
    const ps = players('MINER', 'DISRUPTOR', 'MINER', 'MINER');
    expect(points(ps, minersWin('p2'))).toEqual([2, 0, 3, 2]);
    expect(scoreRound(ps, minersWin('p2'))[2]?.reason).toBe('MINERS_WON_CONNECTOR');
  });

  it('no connector bonus when a disruptor completed the tunnel', () => {
    expect(points(players('MINER', 'DISRUPTOR', 'MINER'), minersWin('p1'))).toEqual([2, 0, 2]);
  });

  it('disruptors win: 3 each, or 4 for a sole dealt disruptor', () => {
    expect(points(players('DISRUPTOR', 'MINER', 'DISRUPTOR'), disruptorsWin)).toEqual([3, 0, 3]);
    expect(points(players('MINER', 'DISRUPTOR', 'MINER'), disruptorsWin)).toEqual([0, 4, 0]);
    // A dealt disruptor who left still counts as "dealt" for the sole-disruptor rule.
    expect(points(players('DISRUPTOR', 'DISRUPTOR!left', 'MINER'), disruptorsWin)).toEqual([
      3, 0, 0,
    ]);
  });

  it('nobody scores with zero disruptors dealt, no winner, or after leaving', () => {
    expect(points(players('MINER', 'MINER', 'MINER'), disruptorsWin)).toEqual([0, 0, 0]);
    expect(
      points(players('MINER', 'DISRUPTOR'), {
        winner: 'NONE',
        endReason: 'INSUFFICIENT_PLAYERS',
        connectorId: null,
      }),
    ).toEqual([0, 0]);
    const ps = players('MINER!left', 'MINER', 'DISRUPTOR');
    expect(points(ps, minersWin('p0'))).toEqual([0, 2, 0]);
    expect(scoreRound(ps, minersWin('p0'))[0]?.reason).toBe('LEFT');
  });
});

describe('standings', () => {
  it('ranks by total, then rounds won; remaining ties share a rank', () => {
    const seats = ['a', 'b', 'c', 'd', 'e'].map((playerId, seat) => ({
      playerId,
      seat,
      hasLeft: false,
    }));
    const e = (playerId: string, pts: number) => ({
      playerId,
      points: pts,
      reason: 'LOST' as const,
    });
    const rounds = [
      [e('a', 4), e('b', 2), e('c', 3), e('d', 2), e('e', 0)],
      [e('a', 0), e('b', 2), e('c', 0), e('d', 2), e('e', 3)],
    ];
    const standings = computeStandings(seats, rounds);
    expect(standings.map((s) => [s.playerId, s.total, s.roundsWon, s.rank])).toEqual([
      ['b', 4, 2, 1],
      ['d', 4, 2, 1],
      ['a', 4, 1, 3],
      ['c', 3, 1, 4],
      ['e', 3, 1, 4],
    ]);
  });
});
