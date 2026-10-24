/** Directions, neighbours and rotation (GAME_RULES §4.3, §4.5). */

export interface Coord {
  readonly x: number;
  readonly y: number;
}

/** Canonical order. Every list of directions in the domain is kept in this order. */
export const DIRECTIONS = ['N', 'E', 'S', 'W'] as const;
export type Direction = (typeof DIRECTIONS)[number];

const OPPOSITE: Readonly<Record<Direction, Direction>> = { N: 'S', E: 'W', S: 'N', W: 'E' };
// y grows south, so north is y - 1.
const DELTA: Readonly<Record<Direction, Coord>> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

export function opposite(direction: Direction): Direction {
  return OPPOSITE[direction];
}

export function neighbor(coord: Coord, direction: Direction): Coord {
  const delta = DELTA[direction];
  return { x: coord.x + delta.x, y: coord.y + delta.y };
}

/** Only 0° and 180° placements exist in v1 (GAME_RULES §4.5). */
export const ROTATIONS = [0, 180] as const;
export type Rotation = (typeof ROTATIONS)[number];

export function isRotation(value: unknown): value is Rotation {
  return value === 0 || value === 180;
}

export function rotateDirection(direction: Direction, rotation: Rotation): Direction {
  return rotation === 0 ? direction : opposite(direction);
}

/** Stable map key for a coordinate, e.g. "3,-1". */
export function coordKey(coord: Coord): string {
  return `${coord.x},${coord.y}`;
}

export function sameCoord(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y;
}

export function sortDirections(directions: readonly Direction[]): Direction[] {
  return DIRECTIONS.filter((d) => directions.includes(d));
}
