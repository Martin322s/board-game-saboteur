import { pathTopology } from '../cards/catalog.ts';
import type { PathTypeId } from '../cards/types.ts';
import {
  BOARD_BOUNDS,
  DESTINATION_COORDS,
  START_COORD,
  type BoardBounds,
} from '../config/board.ts';
import type { CardId, DestinationIdentity, DestinationSlot, PlayerId } from '../primitives.ts';
import { coordKey, sameCoord, type Coord, type Rotation } from './direction.ts';
import { FULLY_OPEN, type PathTopology } from './topology.ts';

/**
 * The board is entirely PUBLIC information: placed path cards plus, per destination slot,
 * its identity once revealed (null while hidden). Secret destination identities live in the
 * round state, never here. Start and destination coordinates are fixed by config.
 */
export interface PlacedPath {
  readonly cardId: CardId;
  readonly typeId: PathTypeId;
  readonly rotation: Rotation;
  readonly x: number;
  readonly y: number;
  readonly placedBy: PlayerId;
  readonly placedOnTurn: number;
}

export interface BoardDestination {
  readonly slot: DestinationSlot;
  readonly x: number;
  readonly y: number;
  readonly revealed: DestinationIdentity | null;
}

export interface Board {
  /** Keyed by coordKey ("x,y"). Plain object so the board serialises as JSON. */
  readonly paths: Readonly<Record<string, PlacedPath>>;
  readonly destinations: readonly BoardDestination[];
}

export function createInitialBoard(): Board {
  return {
    paths: {},
    destinations: DESTINATION_COORDS.map((c, slot) => ({
      slot: slot as DestinationSlot,
      x: c.x,
      y: c.y,
      revealed: null,
    })),
  };
}

export type CellContent =
  | { readonly kind: 'EMPTY' }
  | { readonly kind: 'START'; readonly topology: PathTopology }
  | { readonly kind: 'PATH'; readonly path: PlacedPath; readonly topology: PathTopology }
  | { readonly kind: 'DESTINATION'; readonly destination: BoardDestination };

export function cellAt(board: Board, coord: Coord): CellContent {
  if (sameCoord(coord, START_COORD)) return { kind: 'START', topology: FULLY_OPEN };
  const destination = board.destinations.find((d) => d.x === coord.x && d.y === coord.y);
  if (destination) return { kind: 'DESTINATION', destination };
  const path = board.paths[coordKey(coord)];
  if (path) return { kind: 'PATH', path, topology: pathTopology(path.typeId, path.rotation) };
  return { kind: 'EMPTY' };
}

/**
 * Topology used for traversal, or null when the cell cannot be traversed
 * (empty, or a destination that is still hidden). A revealed destination is one internal
 * segment, but it is only entered or left through a NEIGHBOUR'S open facing side (§4.6).
 */
export function traversableTopology(cell: CellContent): PathTopology | null {
  switch (cell.kind) {
    case 'START':
    case 'PATH':
      return cell.topology;
    case 'DESTINATION':
      return cell.destination.revealed === null ? null : FULLY_OPEN;
    case 'EMPTY':
      return null;
  }
}

export function isWithinBounds(coord: Coord, bounds: BoardBounds = BOARD_BOUNDS): boolean {
  return (
    Number.isInteger(coord.x) &&
    Number.isInteger(coord.y) &&
    coord.x >= bounds.minX &&
    coord.x <= bounds.maxX &&
    coord.y >= bounds.minY &&
    coord.y <= bounds.maxY
  );
}

export function placePath(board: Board, placed: PlacedPath): Board {
  return { ...board, paths: { ...board.paths, [coordKey(placed)]: placed } };
}

export function removePath(board: Board, coord: Coord): Board {
  const key = coordKey(coord);
  const paths = Object.fromEntries(Object.entries(board.paths).filter(([k]) => k !== key));
  return { ...board, paths };
}

export function revealDestination(
  board: Board,
  slot: DestinationSlot,
  identity: DestinationIdentity,
): Board {
  return {
    ...board,
    destinations: board.destinations.map((d) =>
      d.slot === slot ? { ...d, revealed: identity } : d,
    ),
  };
}

export function boardCoords(bounds: BoardBounds = BOARD_BOUNDS): Coord[] {
  const coords: Coord[] = [];
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) coords.push({ x, y });
  }
  return coords;
}
