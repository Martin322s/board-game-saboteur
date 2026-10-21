import { describe, expect, it } from 'vitest';
import { isValidTopology } from '../board/topology.ts';
import { cardKind, getCardDef, isPathDef } from '../cards/catalog.ts';
import { buildShuffledDeck, expandCatalog } from '../deck/deck.ts';
import { createSeededRng } from '../rng/rng.ts';
import {
  DECK_CATALOG,
  EXPECTED_ACTION_CARDS,
  EXPECTED_DECK_SIZE,
  EXPECTED_PATH_CARDS,
} from './deck.ts';

// GAME_RULES §5.1 / §5.2, transcribed independently from the catalog.
const SPEC_QUANTITIES = {
  PATH_CROSS: 5,
  PATH_T_EWS: 5,
  PATH_T_NSE: 5,
  PATH_STRAIGHT_EW: 4,
  PATH_STRAIGHT_NS: 3,
  PATH_CORNER_SE: 4,
  PATH_CORNER_SW: 4,
  DEAD_CROSS: 1,
  DEAD_T_EWS: 1,
  DEAD_T_NSE: 1,
  DEAD_STRAIGHT_EW: 1,
  DEAD_STRAIGHT_NS: 1,
  DEAD_CORNER_SE: 1,
  DEAD_CORNER_SW: 1,
  DEAD_END_S: 1,
  DEAD_END_E: 1,
  BREAK_DRILL: 3,
  BREAK_LAMP: 3,
  BREAK_ROPE: 3,
  REPAIR_DRILL: 2,
  REPAIR_LAMP: 2,
  REPAIR_ROPE: 2,
  REPAIR_DRILL_LAMP: 1,
  REPAIR_LAMP_ROPE: 1,
  REPAIR_DRILL_ROPE: 1,
  SCOUT: 6,
  COLLAPSE: 3,
};

const SPEC_OPENINGS: Record<string, string> = {
  PATH_CROSS: 'NESW',
  PATH_T_EWS: 'ESW',
  PATH_T_NSE: 'NES',
  PATH_STRAIGHT_EW: 'EW',
  PATH_STRAIGHT_NS: 'NS',
  PATH_CORNER_SE: 'ES',
  PATH_CORNER_SW: 'SW',
  DEAD_END_S: 'S',
  DEAD_END_E: 'E',
};

const sum = (n: number[]) => n.reduce((a, b) => a + b, 0);

describe('card catalog', () => {
  it('has exactly 66 cards: 39 path + 27 action', () => {
    const paths = DECK_CATALOG.filter((d) => cardKind(d) === 'PATH');
    const actions = DECK_CATALOG.filter((d) => cardKind(d) === 'ACTION');
    expect(sum(DECK_CATALOG.map((d) => d.quantity))).toBe(EXPECTED_DECK_SIZE);
    expect(sum(paths.map((d) => d.quantity))).toBe(EXPECTED_PATH_CARDS);
    expect(sum(actions.map((d) => d.quantity))).toBe(EXPECTED_ACTION_CARDS);
    expect([EXPECTED_DECK_SIZE, EXPECTED_PATH_CARDS, EXPECTED_ACTION_CARDS]).toEqual([66, 39, 27]);
  });

  it('matches GAME_RULES quantities exactly, with unique type ids', () => {
    const actual = Object.fromEntries(DECK_CATALOG.map((d) => [d.typeId, d.quantity]));
    expect(actual).toEqual(SPEC_QUANTITIES);
    expect(new Set(DECK_CATALOG.map((d) => d.typeId)).size).toBe(DECK_CATALOG.length);
  });

  it('has valid topologies: connected = one segment, dead end = isolated openings', () => {
    let connected = 0;
    for (const def of DECK_CATALOG.filter(isPathDef)) {
      expect(isValidTopology(def.topology)).toBe(true);
      if (def.typeId.startsWith('PATH_')) {
        connected += def.quantity;
        expect(def.topology.segments).toHaveLength(1);
      } else {
        expect(def.topology.segments.every((s) => s.length === 1)).toBe(true);
      }
      const expected =
        SPEC_OPENINGS[def.typeId] ?? SPEC_OPENINGS[def.typeId.replace('DEAD_', 'PATH_')];
      expect(def.topology.openings.join('')).toBe(expected); // canonical N,E,S,W order
    }
    expect(connected).toBe(30);
  });

  it('associates tools with sabotage/repair cards', () => {
    expect(getCardDef('BREAK_LAMP')).toMatchObject({ category: 'SABOTAGE', tool: 'LAMP' });
    expect(getCardDef('REPAIR_DRILL_ROPE')).toMatchObject({
      category: 'REPAIR',
      tools: ['DRILL', 'ROPE'],
    });
  });

  it('builds a shuffled deck of 66 uniquely identified instances', () => {
    const deck = buildShuffledDeck(createSeededRng('deck'));
    expect(deck).toHaveLength(66);
    expect(new Set(deck.map((c) => c.id)).size).toBe(66);
    expect(deck.map((c) => c.typeId).sort()).toEqual(expandCatalog().sort());
    expect(deck.map((c) => c.typeId)).not.toEqual(expandCatalog());
  });
});
