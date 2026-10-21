import type { Coord } from '../board/direction.ts';

/** Board geometry (GAME_RULES §4.1, §4.2). */

export interface BoardBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Fixed 5 × 9 matrix. Columns 0 and 8 contain the entrance and destinations;
 * exactly seven tunnel columns (1–7) lie between them. y grows south. */
export const BOARD_BOUNDS: BoardBounds = { minX: 0, maxX: 8, minY: -2, maxY: 2 };

export const START_COORD: Coord = { x: 0, y: 0 };

/** Index = destination slot. */
export const DESTINATION_COORDS: readonly [Coord, Coord, Coord] = [
  { x: 8, y: -2 },
  { x: 8, y: 0 },
  { x: 8, y: 2 },
];
