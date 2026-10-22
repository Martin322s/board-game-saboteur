import { describe, expect, it } from 'vitest';
import { handSizeFor } from '../config/players.ts';
import { ROLE_POOLS } from '../config/roles.ts';
import { NOW } from '../testing/builders.ts';
import { decideAfterRound } from './gameFlow.ts';
import { createRound, type CreateRoundInput } from './createRound.ts';

const input = (n: number, overrides: Partial<CreateRoundInput> = {}): CreateRoundInput => ({
  players: Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, seat: i * 2 })),
  roundNo: 1,
  seed: `seed-${n}`,
  previousStartingSeat: null,
  now: NOW,
  ...overrides,
});

const unwrap = (i: CreateRoundInput) => {
  const r = createRound(i);
  if (!r.ok) throw new Error(r.error.code);
  return r.value.state;
};

describe('createRound', () => {
  it.each([3, 4, 5, 6, 7, 8, 9, 10])('sets up %i players per GAME_RULES §2', (n) => {
    const state = unwrap(input(n));
    const handSize = handSizeFor(n);
    const handIds = state.players.flatMap((p) => p.hand.cards.map((c) => c.id));

    expect(state.players.every((p) => p.hand.cards.length === handSize)).toBe(true);
    expect(
      state.players.every(
        (p) =>
          p.hand.cards.map((c) => c.handPosition).join() === [...Array(handSize).keys()].join(),
      ),
    ).toBe(true);
    expect(state.drawPile).toHaveLength(66 - n * handSize);
    expect(new Set([...handIds, ...state.drawPile.map((c) => c.id)]).size).toBe(66);

    const roles = [...state.players.map((p) => p.role), state.setAsideRole];
    const pool = ROLE_POOLS[n];
    expect(roles.filter((r) => r === 'DISRUPTOR')).toHaveLength(pool?.disruptors ?? -1);
    expect([...state.destinationIdentities].sort()).toEqual(['EMPTY', 'EMPTY', 'TREASURE']);

    expect(state).toMatchObject({
      phase: 'ROUND_ACTIVE',
      version: 1,
      turnNumber: 1,
      turnDeadline: NOW + 60_000,
    });
    expect(state.players.map((p) => p.playerId)).toContain(state.activePlayerId);
  });

  it('is fully deterministic for a seed and differs across seeds', () => {
    expect(createRound(input(5))).toEqual(createRound(input(5)));
    expect(unwrap(input(5)).drawPile).not.toEqual(unwrap(input(5, { seed: 'other' })).drawPile);
  });

  it('later rounds start at the first seat after the previous starting seat', () => {
    expect(unwrap(input(4, { roundNo: 2, previousStartingSeat: 2 })).startingSeat).toBe(4);
    expect(unwrap(input(4, { roundNo: 2, previousStartingSeat: 6 })).startingSeat).toBe(0);
    expect(unwrap(input(4, { roundNo: 3, previousStartingSeat: 3 })).startingSeat).toBe(4);
  });

  it('rejects unsupported counts and duplicate players or seats', () => {
    const bad = { ok: false, error: { code: 'INVALID_PLAYER_COUNT' } };
    expect(createRound(input(2))).toEqual(bad);
    expect(createRound(input(11))).toEqual(bad);
    expect(
      createRound({
        ...input(3),
        players: [
          { playerId: 'a', seat: 0 },
          { playerId: 'a', seat: 1 },
          { playerId: 'b', seat: 2 },
        ],
      }),
    ).toEqual(bad);
    expect(
      createRound({
        ...input(3),
        players: [
          { playerId: 'a', seat: 0 },
          { playerId: 'b', seat: 0 },
          { playerId: 'c', seat: 2 },
        ],
      }),
    ).toEqual(bad);
  });

  it('decides between another round and finishing the game', () => {
    expect(decideAfterRound(1, 5)).toBe('START_NEXT_ROUND');
    expect(decideAfterRound(3, 5)).toBe('FINISH_GAME');
    expect(decideAfterRound(2, 2)).toBe('FINISH_GAME');
  });
});
