import type { CardId } from '../primitives.ts';
import { nextInt, type Rng } from './rng.ts';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const ID_LENGTH = 10;

/**
 * Opaque card instance ids: "c" + 10 base32 chars, unique within the batch (GAME_RULES §2.3
 * step 4). They carry no information about card type or deck position.
 */
export function generateCardIds(count: number, rng: Rng): CardId[] {
  const ids: CardId[] = [];
  const seen = new Set<string>();
  while (ids.length < count) {
    let id = 'c';
    for (let i = 0; i < ID_LENGTH; i++) id += BASE32[nextInt(rng, BASE32.length)];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
