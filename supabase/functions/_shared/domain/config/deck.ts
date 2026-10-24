import { connectedTopology, deadEndTopology } from '../board/topology.ts';
import type { CardDef } from '../cards/types.ts';

/**
 * The exact v1 deck (GAME_RULES §5): 39 path cards + 27 action cards = 66.
 * Catalog order is significant: it is the pre-shuffle order used by round setup (§2.3 step 4).
 */
export const DECK_CATALOG: readonly CardDef[] = [
  // Path cards — connected (30)
  {
    typeId: 'PATH_CROSS',
    category: 'PATH',
    quantity: 5,
    topology: connectedTopology('N', 'E', 'S', 'W'),
  },
  {
    typeId: 'PATH_T_EWS',
    category: 'PATH',
    quantity: 5,
    topology: connectedTopology('E', 'W', 'S'),
  },
  {
    typeId: 'PATH_T_NSE',
    category: 'PATH',
    quantity: 5,
    topology: connectedTopology('N', 'S', 'E'),
  },
  {
    typeId: 'PATH_STRAIGHT_EW',
    category: 'PATH',
    quantity: 4,
    topology: connectedTopology('E', 'W'),
  },
  {
    typeId: 'PATH_STRAIGHT_NS',
    category: 'PATH',
    quantity: 3,
    topology: connectedTopology('N', 'S'),
  },
  {
    typeId: 'PATH_CORNER_SE',
    category: 'PATH',
    quantity: 4,
    topology: connectedTopology('S', 'E'),
  },
  {
    typeId: 'PATH_CORNER_SW',
    category: 'PATH',
    quantity: 4,
    topology: connectedTopology('S', 'W'),
  },
  // Path cards — dead ends (9)
  {
    typeId: 'DEAD_CROSS',
    category: 'PATH',
    quantity: 1,
    topology: deadEndTopology('N', 'E', 'S', 'W'),
  },
  { typeId: 'DEAD_T_EWS', category: 'PATH', quantity: 1, topology: deadEndTopology('E', 'W', 'S') },
  { typeId: 'DEAD_T_NSE', category: 'PATH', quantity: 1, topology: deadEndTopology('N', 'S', 'E') },
  {
    typeId: 'DEAD_STRAIGHT_EW',
    category: 'PATH',
    quantity: 1,
    topology: deadEndTopology('E', 'W'),
  },
  {
    typeId: 'DEAD_STRAIGHT_NS',
    category: 'PATH',
    quantity: 1,
    topology: deadEndTopology('N', 'S'),
  },
  { typeId: 'DEAD_CORNER_SE', category: 'PATH', quantity: 1, topology: deadEndTopology('S', 'E') },
  { typeId: 'DEAD_CORNER_SW', category: 'PATH', quantity: 1, topology: deadEndTopology('S', 'W') },
  { typeId: 'DEAD_END_S', category: 'PATH', quantity: 1, topology: deadEndTopology('S') },
  { typeId: 'DEAD_END_E', category: 'PATH', quantity: 1, topology: deadEndTopology('E') },
  // Action cards (27)
  { typeId: 'BREAK_DRILL', category: 'SABOTAGE', quantity: 3, tool: 'DRILL' },
  { typeId: 'BREAK_LAMP', category: 'SABOTAGE', quantity: 3, tool: 'LAMP' },
  { typeId: 'BREAK_ROPE', category: 'SABOTAGE', quantity: 3, tool: 'ROPE' },
  { typeId: 'REPAIR_DRILL', category: 'REPAIR', quantity: 2, tools: ['DRILL'] },
  { typeId: 'REPAIR_LAMP', category: 'REPAIR', quantity: 2, tools: ['LAMP'] },
  { typeId: 'REPAIR_ROPE', category: 'REPAIR', quantity: 2, tools: ['ROPE'] },
  { typeId: 'REPAIR_DRILL_LAMP', category: 'REPAIR', quantity: 1, tools: ['DRILL', 'LAMP'] },
  { typeId: 'REPAIR_LAMP_ROPE', category: 'REPAIR', quantity: 1, tools: ['LAMP', 'ROPE'] },
  { typeId: 'REPAIR_DRILL_ROPE', category: 'REPAIR', quantity: 1, tools: ['DRILL', 'ROPE'] },
  { typeId: 'SCOUT', category: 'INSPECT', quantity: 6 },
  { typeId: 'COLLAPSE', category: 'BOARD', quantity: 3 },
];

export const EXPECTED_DECK_SIZE = 66;
export const EXPECTED_PATH_CARDS = 39;
export const EXPECTED_ACTION_CARDS = 27;
