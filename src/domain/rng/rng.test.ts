import { describe, expect, it } from 'vitest';
import { generateCardIds } from './ids.ts';
import { createSeededRng, createSequenceRng, nextInt } from './rng.ts';
import { shuffle } from './shuffle.ts';

const take = (seed: string, n: number) => {
  const rng = createSeededRng(seed);
  return Array.from({ length: n }, () => rng.nextUint32());
};

describe('seeded rng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    expect(take('alpha', 8)).toEqual(take('alpha', 8));
    expect(take('alpha', 8)).not.toEqual(take('beta', 8));
    expect(take('alpha', 100).every((v) => Number.isInteger(v) && v >= 0 && v < 2 ** 32)).toBe(
      true,
    );
  });

  it('nextInt stays in range and rejects bad bounds', () => {
    const rng = createSeededRng('range');
    const values = Array.from({ length: 500 }, () => nextInt(rng, 7));
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBe(6);
    expect(() => nextInt(rng, 0)).toThrow(RangeError);
    expect(() => nextInt(rng, 2.5)).toThrow(RangeError);
  });

  it('shuffle is a deterministic permutation that does not mutate its input', () => {
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const a = shuffle(input, createSeededRng('shuffle'));
    expect(a).toEqual(shuffle(input, createSeededRng('shuffle')));
    expect([...a].sort((x, y) => x - y)).toEqual([...input]);
    expect(a).not.toEqual([...input]);
  });

  it('a sequence rng of zeros yields the documented Fisher–Yates result', () => {
    // j = 0 at every step: i=3 swaps 0↔3, i=2 swaps 0↔2, i=1 swaps 0↔1.
    expect(shuffle(['a', 'b', 'c', 'd'], createSequenceRng([0]))).toEqual(['b', 'c', 'd', 'a']);
  });

  it('generates unique opaque card ids', () => {
    const ids = generateCardIds(66, createSeededRng('ids'));
    expect(new Set(ids).size).toBe(66);
    expect(ids.every((id) => /^c[a-z2-7]{10}$/.test(id))).toBe(true);
    // Collisions are regenerated: a constant rng would loop forever, a short cycle must not.
    expect(
      new Set(generateCardIds(3, createSequenceRng([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]))).size,
    ).toBe(3);
  });
});
