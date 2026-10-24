import { START_COORD } from '../config/board.ts';
import type { DestinationSlot } from '../primitives.ts';
import { cellAt, isWithinBounds, traversableTopology, type Board } from './board.ts';
import { coordKey, neighbor, opposite, type Coord, type Direction } from './direction.ts';
import { segmentIndexOf } from './topology.ts';

/**
 * Reachability from Start (GAME_RULES §7.2).
 *
 * BFS over nodes (cell, segmentIndex). From a node, every opening of that segment leads to the
 * neighbouring cell; if that cell is traversable and open on the facing side, the neighbour's
 * segment containing the facing side is visited. Dead-end openings form their own segment, so
 * they are reached but never propagate.
 *
 * Hidden destinations are not traversable; the BFS records which hidden destinations are faced
 * by a reached opening (§7.3 step 2). Destination identities are never needed here.
 */
export interface Reachability {
  /** Node keys "x,y#segmentIndex". */
  readonly visited: ReadonlySet<string>;
  /** Cells with at least one reached segment, in BFS order (no duplicates). */
  readonly reachedCells: readonly Coord[];
  /** Hidden destination slots touched by a reached opening, ascending. */
  readonly touchedHiddenDestinations: readonly DestinationSlot[];
}

function nodeKey(coord: Coord, segment: number): string {
  return `${coordKey(coord)}#${segment}`;
}

export function computeReachability(board: Board): Reachability {
  const visited = new Set<string>();
  const touched = new Set<DestinationSlot>();
  const queue: { coord: Coord; segment: number }[] = [{ coord: START_COORD, segment: 0 }];
  visited.add(nodeKey(START_COORD, 0));
  const reachedCells = new Map<string, Coord>([[coordKey(START_COORD), START_COORD]]);

  for (let head = 0; head < queue.length; head++) {
    const node = queue[head] as { coord: Coord; segment: number };
    const topology = traversableTopology(cellAt(board, node.coord));
    const segment = topology?.segments[node.segment];
    if (!segment) continue;

    for (const direction of segment) {
      const next = neighbor(node.coord, direction);
      if (!isWithinBounds(next)) continue;
      const cell = cellAt(board, next);
      if (cell.kind === 'DESTINATION' && cell.destination.revealed === null) {
        touched.add(cell.destination.slot);
        continue;
      }
      const nextTopology = traversableTopology(cell);
      if (!nextTopology) continue;
      const nextSegment = segmentIndexOf(nextTopology, opposite(direction));
      if (nextSegment === -1) continue;
      const key = nodeKey(next, nextSegment);
      if (!visited.has(key)) {
        visited.add(key);
        reachedCells.set(coordKey(next), next);
        queue.push({ coord: next, segment: nextSegment });
      }
    }
  }

  return {
    visited,
    reachedCells: [...reachedCells.values()],
    touchedHiddenDestinations: [...touched].sort((a, b) => a - b),
  };
}

/** Is the given opening of the card at `coord` reached from Start? */
export function isOpeningReached(
  board: Board,
  reachability: Reachability,
  coord: Coord,
  direction: Direction,
): boolean {
  const topology = traversableTopology(cellAt(board, coord));
  if (!topology) return false;
  const segment = segmentIndexOf(topology, direction);
  return segment !== -1 && reachability.visited.has(nodeKey(coord, segment));
}

/** Is any segment of the card at `coord` reached from Start? */
export function isCellReached(reachability: Reachability, coord: Coord): boolean {
  return reachability.reachedCells.some((c) => c.x === coord.x && c.y === coord.y);
}
