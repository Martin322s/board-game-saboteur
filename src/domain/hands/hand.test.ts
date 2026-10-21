import { describe, expect, it } from 'vitest';
import { handOf } from '../testing/builders.ts';
import {
  addCardToHand,
  canonicalHandOrder,
  drawCardIntoHand,
  EMPTY_HAND,
  removeCardFromHand,
  selectTimeoutDiscard,
  type HandState,
} from './hand.ts';

const positions = (hand: HandState) => hand.cards.map((c) => c.handPosition);

describe('hand positions', () => {
  it('assigns monotonically increasing positions from a per-hand counter', () => {
    const hand = handOf('p', ['PATH_CROSS', 'SCOUT', 'COLLAPSE']);
    expect(positions(hand)).toEqual([0, 1, 2]);
    expect(hand.nextHandPosition).toBe(3);
  });

  it('never renumbers on removal; later draws continue the counter', () => {
    let hand = handOf('p', ['PATH_CROSS', 'SCOUT', 'COLLAPSE']);
    hand = removeCardFromHand(hand, 'p:0')?.hand ?? hand;
    hand = removeCardFromHand(hand, 'p:2')?.hand ?? hand;
    expect(positions(hand)).toEqual([1]);
    const drawn = drawCardIntoHand([{ id: 'd1', typeId: 'BREAK_LAMP' }], hand);
    expect(drawn.drawn).toMatchObject({ id: 'd1', handPosition: 3 });
    expect(drawn.pile).toEqual([]);
    expect(positions(drawn.hand)).toEqual([1, 3]);
    expect(removeCardFromHand(hand, 'missing')).toBeNull();
  });

  it('drawing from an empty pile leaves the hand unchanged', () => {
    const hand = handOf('p', ['SCOUT']);
    expect(drawCardIntoHand([], hand)).toEqual({ pile: [], hand, drawn: null });
  });

  it('canonical order and timeout discard ignore client-side ordering', () => {
    let hand = EMPTY_HAND;
    for (const id of ['a', 'b', 'c', 'd']) hand = addCardToHand(hand, { id, typeId: 'SCOUT' });
    hand = removeCardFromHand(hand, 'a')?.hand ?? hand; // gap at position 0
    const clientOrder = [...hand.cards].reverse(); // e.g. user dragged cards around
    expect(canonicalHandOrder(clientOrder).map((c) => c.id)).toEqual(['b', 'c', 'd']);
    expect(selectTimeoutDiscard(clientOrder)?.id).toBe('b');
    expect(selectTimeoutDiscard([])).toBeNull();
  });
});
