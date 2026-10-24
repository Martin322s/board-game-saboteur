import type { PathTopology } from '../board/topology.ts';
import type { CardId, Tool } from '../primitives.ts';

/** Card definitions are immutable catalog data; instances carry a unique per-round id. */

export type PathTypeId =
  | 'PATH_CROSS'
  | 'PATH_T_EWS'
  | 'PATH_T_NSE'
  | 'PATH_STRAIGHT_EW'
  | 'PATH_STRAIGHT_NS'
  | 'PATH_CORNER_SE'
  | 'PATH_CORNER_SW'
  | 'DEAD_CROSS'
  | 'DEAD_T_EWS'
  | 'DEAD_T_NSE'
  | 'DEAD_STRAIGHT_EW'
  | 'DEAD_STRAIGHT_NS'
  | 'DEAD_CORNER_SE'
  | 'DEAD_CORNER_SW'
  | 'DEAD_END_S'
  | 'DEAD_END_E';

export type ActionTypeId =
  | 'BREAK_DRILL'
  | 'BREAK_LAMP'
  | 'BREAK_ROPE'
  | 'REPAIR_DRILL'
  | 'REPAIR_LAMP'
  | 'REPAIR_ROPE'
  | 'REPAIR_DRILL_LAMP'
  | 'REPAIR_LAMP_ROPE'
  | 'REPAIR_DRILL_ROPE'
  | 'SCOUT'
  | 'COLLAPSE';

export type CardTypeId = PathTypeId | ActionTypeId;

/** GAME_RULES §5.3. Every non-PATH category is an "action card". */
export type CardCategory = 'PATH' | 'SABOTAGE' | 'REPAIR' | 'INSPECT' | 'BOARD';
export type CardKind = 'PATH' | 'ACTION';

export interface PathCardDef {
  readonly typeId: PathTypeId;
  readonly category: 'PATH';
  readonly quantity: number;
  /** Topology at rotation 0. */
  readonly topology: PathTopology;
}

export interface SabotageCardDef {
  readonly typeId: ActionTypeId;
  readonly category: 'SABOTAGE';
  readonly quantity: number;
  readonly tool: Tool;
}

export interface RepairCardDef {
  readonly typeId: ActionTypeId;
  readonly category: 'REPAIR';
  readonly quantity: number;
  /** One tool (single repair) or two tools (player chooses one). */
  readonly tools: readonly Tool[];
}

export interface InspectCardDef {
  readonly typeId: ActionTypeId;
  readonly category: 'INSPECT';
  readonly quantity: number;
}

export interface BoardCardDef {
  readonly typeId: ActionTypeId;
  readonly category: 'BOARD';
  readonly quantity: number;
}

export type ActionCardDef = SabotageCardDef | RepairCardDef | InspectCardDef | BoardCardDef;
export type CardDef = PathCardDef | ActionCardDef;

/** A runtime card. Copies of the same definition have distinct opaque ids. */
export interface CardInstance {
  readonly id: CardId;
  readonly typeId: CardTypeId;
}
