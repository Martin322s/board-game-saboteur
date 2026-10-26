import {
  BOARD_BOUNDS,
  cellAt,
  connectedTopology,
  DIRECTIONS,
  isOpen,
  neighbor,
  opposite,
  type Board,
  type Coord,
  type PathTopology,
} from '../../../domain/index.ts';

/** World units per board cell. Domain (x, y) → world coordinates; never stored in state. */
export const CELL = 100;

export const cellOrigin = (c: Coord) => ({
  x: (c.x - BOARD_BOUNDS.minX) * CELL,
  y: (c.y - BOARD_BOUNDS.minY) * CELL,
});

/**
 * Sides on which a revealed destination is DRAWN open. Destinations never constrain placement
 * (GAME_RULES §4.6), so a neighbour may face one with a closed side, and they connect only
 * through a neighbour's open facing side. Draw a mouth exactly where such a connection exists.
 */
export function destinationArtTopology(board: Board, destination: Coord): PathTopology {
  return connectedTopology(
    ...DIRECTIONS.filter((direction) => {
      const cell = cellAt(board, neighbor(destination, direction));
      return (
        (cell.kind === 'PATH' || cell.kind === 'START') &&
        isOpen(cell.topology, opposite(direction))
      );
    }),
  );
}
