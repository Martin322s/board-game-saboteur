/**
 * Deterministic randomness (GAME_RULES §2.3 step 1).
 *
 * The domain only CONSUMES randomness. Production seeds are generated at the authoritative
 * server boundary (Edge Function, crypto.getRandomValues) and passed in as strings.
 *
 * Fixed algorithm: seed string → cyrb128 (four 32-bit words) → xoshiro128**.
 * Changing this changes every round produced from a given seed: bump RULES_VERSION.
 */
export interface Rng {
  /** Uniform unsigned 32-bit integer. */
  nextUint32(): number;
}

function cyrb128(input: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function createSeededRng(seed: string): Rng {
  let [a, b, c, d] = cyrb128(seed);
  if ((a | b | c | d) === 0) a = 1; // xoshiro state must not be all zero
  return {
    nextUint32() {
      const result = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0;
      const t = b << 9;
      c ^= a;
      d ^= b;
      b ^= c;
      a ^= d;
      c ^= t;
      d = rotl(d, 11);
      return result;
    },
  };
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

const UINT32_RANGE = 0x1_0000_0000;

/** Uniform integer in [0, maxExclusive) using rejection sampling (no modulo bias). */
export function nextInt(rng: Rng, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > UINT32_RANGE) {
    throw new RangeError(`nextInt bound must be an integer in [1, 2^32], got ${maxExclusive}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
  for (;;) {
    const value = rng.nextUint32();
    if (value < limit) return value % maxExclusive;
  }
}

/**
 * Test helper: replays the given uint32 values cyclically.
 * Useful to force specific shuffle outcomes in tests.
 */
export function createSequenceRng(values: readonly number[]): Rng {
  if (values.length === 0) throw new RangeError('createSequenceRng needs at least one value');
  let index = 0;
  return {
    nextUint32() {
      const value = values[index % values.length] as number;
      index++;
      return value >>> 0;
    },
  };
}
