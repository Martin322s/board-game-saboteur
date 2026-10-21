import { describe, expect, it } from 'vitest';
import { handSizeFor } from '../config/players.ts';
import { createSeededRng } from '../rng/rng.ts';
import { buildRolePool, dealRoles } from './roles.ts';

// GAME_RULES §2.1 / §2.2: [players, miners, disruptors, hand size]
const TABLE = [
  [3, 3, 1, 6],
  [4, 4, 1, 6],
  [5, 4, 2, 6],
  [6, 5, 2, 5],
  [7, 5, 3, 5],
  [8, 6, 3, 4],
  [9, 7, 3, 4],
  [10, 7, 4, 4],
] as const;

const count = (roles: readonly string[], role: string) => roles.filter((r) => r === role).length;

describe('role distribution', () => {
  it.each(TABLE)(
    '%i players: %i miners + %i disruptors, hand %i',
    (n, miners, disruptors, hand) => {
      const pool = buildRolePool(n);
      if (!pool.ok) throw new Error('expected pool');
      expect(pool.value).toHaveLength(n + 1);
      expect(count(pool.value, 'MINER')).toBe(miners);
      expect(count(pool.value, 'DISRUPTOR')).toBe(disruptors);
      expect(handSizeFor(n)).toBe(hand);

      const deal = dealRoles(n, createSeededRng(`roles-${n}`));
      if (!deal.ok) throw new Error('expected deal');
      expect(deal.value.dealt).toHaveLength(n);
      const all = [...deal.value.dealt, deal.value.setAside];
      expect(count(all, 'MINER')).toBe(miners);
      expect(count(all, 'DISRUPTOR')).toBe(disruptors);
    },
  );

  it('is deterministic for a seed and varies across seeds', () => {
    const a = dealRoles(10, createSeededRng('same'));
    const b = dealRoles(10, createSeededRng('same'));
    expect(a).toEqual(b);
    const setAsides = new Set(
      Array.from({ length: 40 }, (_, i) => {
        const d = dealRoles(3, createSeededRng(`s${i}`));
        return d.ok ? d.value.setAside : null;
      }),
    );
    expect(setAsides).toEqual(new Set(['MINER', 'DISRUPTOR']));
  });

  it.each([0, 2, 11, 3.5])('rejects unsupported player count %s', (n) => {
    expect(buildRolePool(n)).toEqual({ ok: false, error: { code: 'INVALID_PLAYER_COUNT' } });
    expect(() => handSizeFor(n)).toThrow(RangeError);
  });
});
