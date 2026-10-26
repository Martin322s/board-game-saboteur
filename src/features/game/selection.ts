import type { Coord, Rotation, Tool } from '../../domain/index.ts';

/**
 * The player's in-progress choice for the selected card. It records the state version it was
 * made at and is ignored once the server state moves on (card played, turn over, new round).
 */
export interface Selection {
  readonly cardId: string;
  readonly version: number;
  readonly rotation: Rotation;
  readonly cell: Coord | null;
  readonly playerId: string | null;
  readonly tool: Tool | null;
  readonly slot: number | null;
}

export const newSelection = (cardId: string, version: number): Selection => ({
  cardId,
  version,
  rotation: 0,
  cell: null,
  playerId: null,
  tool: null,
  slot: null,
});
