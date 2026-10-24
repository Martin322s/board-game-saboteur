import type { CardInstance } from '../cards/types.ts';
import { drawTop } from '../deck/deck.ts';
import type { CardId, HandPosition } from '../primitives.ts';

/**
 * Server-owned hand positions (GAME_RULES §6.2).
 *
 * Every card entering a hand receives `nextHandPosition`, which then increments. Positions are
 * never renumbered; removals leave gaps. Canonical order is ascending handPosition. Client
 * display order is irrelevant to the rules.
 */
export interface HandCard extends CardInstance {
  readonly handPosition: HandPosition;
}

export interface HandState {
  /** Always kept in canonical order. */
  readonly cards: readonly HandCard[];
  readonly nextHandPosition: HandPosition;
}

export const EMPTY_HAND: HandState = { cards: [], nextHandPosition: 0 };

/** Add a card (deal or draw) at the next hand position. */
export function addCardToHand(hand: HandState, card: CardInstance): HandState {
  return {
    cards: [
      ...hand.cards,
      { id: card.id, typeId: card.typeId, handPosition: hand.nextHandPosition },
    ],
    nextHandPosition: hand.nextHandPosition + 1,
  };
}

export function findCardInHand(hand: HandState, cardId: CardId): HandCard | undefined {
  return hand.cards.find((c) => c.id === cardId);
}

/** Remove a card without renumbering. Returns null if the card is not in the hand. */
export function removeCardFromHand(
  hand: HandState,
  cardId: CardId,
): { readonly hand: HandState; readonly card: HandCard } | null {
  const card = findCardInHand(hand, cardId);
  if (!card) return null;
  return { hand: { ...hand, cards: hand.cards.filter((c) => c.id !== cardId) }, card };
}

/** Draw the top card of the pile into the hand. `drawn` is null when the pile is empty. */
export function drawCardIntoHand(
  pile: readonly CardInstance[],
  hand: HandState,
): {
  readonly pile: readonly CardInstance[];
  readonly hand: HandState;
  readonly drawn: HandCard | null;
} {
  const top = drawTop(pile);
  if (!top) return { pile, hand, drawn: null };
  const nextHand = addCardToHand(hand, top.card);
  return { pile: top.pile, hand: nextHand, drawn: nextHand.cards.at(-1) ?? null };
}

/** Canonical ordering for any (possibly client-reordered) list of hand cards. */
export function canonicalHandOrder(cards: readonly HandCard[]): HandCard[] {
  return [...cards].sort((a, b) => a.handPosition - b.handPosition);
}

/** The card a timeout discards: lowest current handPosition (GAME_RULES §8.5). */
export function selectTimeoutDiscard(cards: readonly HandCard[]): HandCard | null {
  return canonicalHandOrder(cards)[0] ?? null;
}
