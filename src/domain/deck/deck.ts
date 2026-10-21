import type { CardDef, CardInstance, CardTypeId } from '../cards/types.ts';
import { DECK_CATALOG } from '../config/deck.ts';
import { generateCardIds } from '../rng/ids.ts';
import type { Rng } from '../rng/rng.ts';
import { shuffle } from '../rng/shuffle.ts';

/** Expand the catalog into one type id per physical card, in catalog order. */
export function expandCatalog(catalog: readonly CardDef[] = DECK_CATALOG): CardTypeId[] {
  return catalog.flatMap((def) => Array.from({ length: def.quantity }, () => def.typeId));
}

/**
 * GAME_RULES §2.3 step 4: expand in catalog order, Fisher–Yates shuffle, then assign opaque ids
 * in shuffled order. Index 0 is the top of the draw pile.
 */
export function buildShuffledDeck(
  rng: Rng,
  catalog: readonly CardDef[] = DECK_CATALOG,
): CardInstance[] {
  const types = shuffle(expandCatalog(catalog), rng);
  const ids = generateCardIds(types.length, rng);
  return types.map((typeId, i) => ({ id: ids[i] as string, typeId }));
}

/** Take the top card. Returns null when the pile is empty. */
export function drawTop(
  pile: readonly CardInstance[],
): { readonly card: CardInstance; readonly pile: readonly CardInstance[] } | null {
  const [card, ...rest] = pile;
  return card ? { card, pile: rest } : null;
}
