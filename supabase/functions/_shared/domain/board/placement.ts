import { pathTopology } from '../cards/catalog.ts';
import type { PathTypeId } from '../cards/types.ts';
import { cellAt, isWithinBounds, traversableTopology, type Board } from './board.ts';
import {
  coordKey,
  DIRECTIONS,
  isRotation,
  neighbor,
  opposite,
  type Coord,
  type Rotation,
} from './direction.ts';
import { computeReachability, isOpeningReached, type Reachability } from './reachability.ts';
import { edgesMatch, isOpen, type PathTopology } from './topology.ts';

/**
 * Board-level placement legality (GAME_RULES §7.1 steps 6–10, in that order).
 * Steps 1–5 (phase, turn, card ownership, category, blocked) are command-level checks.
 *
 * Uses only PUBLIC information: destinations never constrain placement (§4.6), so legality never
 * depends on which destination holds the treasure.
 */
export type PlacementRejection =
  'INVALID_ROTATION' | 'OUT_OF_BOUNDS' | 'CELL_OCCUPIED' | 'EDGE_MISMATCH' | 'NOT_CONNECTED';

export type PlacementCheck =
  { readonly legal: true } | { readonly legal: false; readonly reason: PlacementRejection };

const LEGAL: PlacementCheck = { legal: true };
const reject = (reason: PlacementRejection): PlacementCheck => ({ legal: false, reason });

export function checkTopologyPlacement(
  board: Board,
  topology: PathTopology,
  coord: Coord,
  reachability: Reachability = computeReachability(board),
): PlacementCheck {
  if (!isWithinBounds(coord)) return reject('OUT_OF_BOUNDS');
  // Start, destinations and existing path cards all occupy their cell.
  if (cellAt(board, coord).kind !== 'EMPTY') return reject('CELL_OCCUPIED');

  for (const direction of DIRECTIONS) {
    const cell = cellAt(board, neighbor(coord, direction));
    if (cell.kind === 'START' || cell.kind === 'PATH') {
      if (!edgesMatch(topology, direction, cell.topology)) return reject('EDGE_MISMATCH');
    }
    // EMPTY: no constraint. DESTINATION (hidden or revealed): never constrains placement, but
    // connects only through this card's own open facing side (checked below / §7.2).
  }

  const connected = DIRECTIONS.some((direction) => {
    if (!isOpen(topology, direction)) return false;
    const next = neighbor(coord, direction);
    const nextTopology = traversableTopology(cellAt(board, next));
    return (
      nextTopology !== null &&
      isOpen(nextTopology, opposite(direction)) &&
      isOpeningReached(board, reachability, next, opposite(direction))
    );
  });
  return connected ? LEGAL : reject('NOT_CONNECTED');
}

export function checkPathPlacement(
  board: Board,
  typeId: PathTypeId,
  coord: Coord,
  rotation: unknown,
  reachability?: Reachability,
): PlacementCheck {
  if (!isRotation(rotation)) return reject('INVALID_ROTATION');
  return checkTopologyPlacement(board, pathTopology(typeId, rotation), coord, reachability);
}

/**
 * All legal cells for a card at a rotation, ordered by y then x. For UX previews.
 * Only empty cells orthogonally adjacent to a reached cell can be connected (rule 10), so only
 * those are checked; the result equals checking every in-bounds cell.
 */
export function legalPlacements(board: Board, typeId: PathTypeId, rotation: Rotation): Coord[] {
  const reachability = computeReachability(board);
  const topology = pathTopology(typeId, rotation);
  const candidates = new Map<string, Coord>();
  for (const cell of reachability.reachedCells) {
    for (const direction of DIRECTIONS) {
      const next = neighbor(cell, direction);
      candidates.set(coordKey(next), next);
    }
  }
  return [...candidates.values()]
    .filter((coord) => checkTopologyPlacement(board, topology, coord, reachability).legal)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}
