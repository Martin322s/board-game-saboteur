import { nextInt, type Rng } from './rng.ts';

/** Fisher–Yates shuffle returning a new array (GAME_RULES §2.3). Input is not mutated. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    const tmp = result[i] as T;
    result[i] = result[j] as T;
    result[j] = tmp;
  }
  return result;
}
