import {
  DIRECTIONS,
  opposite,
  rotateDirection,
  sortDirections,
  type Direction,
  type Rotation,
} from './direction.ts';

/**
 * Explicit card topology (GAME_RULES §4.4).
 *
 * `openings` are the sides with a tunnel mouth. `segments` partition the openings: openings in
 * the same segment are connected through the card centre. A single-opening segment is a dead
 * end (it matches edges but connects to nothing else on the card).
 *
 * Normal form: openings and each segment are in DIRECTIONS order; segments are ordered by the
 * position of their first direction. All constructors and rotate180 return normal form so that
 * structural equality and traversal order are deterministic.
 */
export interface PathTopology {
  readonly openings: readonly Direction[];
  readonly segments: readonly (readonly Direction[])[];
}

function normalize(segments: readonly (readonly Direction[])[]): PathTopology {
  const sortedSegments = segments
    .map((segment) => sortDirections(segment))
    .filter((segment) => segment.length > 0)
    .sort((a, b) => DIRECTIONS.indexOf(a[0] as Direction) - DIRECTIONS.indexOf(b[0] as Direction));
  return { openings: sortDirections(sortedSegments.flat()), segments: sortedSegments };
}

/** All given openings joined through the centre. */
export function connectedTopology(...openings: Direction[]): PathTopology {
  return normalize([openings]);
}

/** Every given opening is isolated (blocked centre). */
export function deadEndTopology(...openings: Direction[]): PathTopology {
  return normalize(openings.map((d) => [d]));
}

/**
 * Start: open on all four sides. Revealed destinations: one internal segment, entered only
 * through a neighbour's open facing side (§4.6).
 */
export const FULLY_OPEN: PathTopology = connectedTopology('N', 'E', 'S', 'W');

export function isOpen(topology: PathTopology, direction: Direction): boolean {
  return topology.openings.includes(direction);
}

/** Index of the segment containing `direction`, or -1 when that side is closed. */
export function segmentIndexOf(topology: PathTopology, direction: Direction): number {
  return topology.segments.findIndex((segment) => segment.includes(direction));
}

export function areInternallyConnected(
  topology: PathTopology,
  a: Direction,
  b: Direction,
): boolean {
  const index = segmentIndexOf(topology, a);
  return index !== -1 && index === segmentIndexOf(topology, b);
}

export function rotateTopology(topology: PathTopology, rotation: Rotation): PathTopology {
  if (rotation === 0) return topology;
  return normalize(topology.segments.map((s) => s.map((d) => rotateDirection(d, rotation))));
}

/** True when the facing edges of two horizontally/vertically adjacent cards agree. */
export function edgesMatch(
  topology: PathTopology,
  towardNeighbor: Direction,
  neighborTopology: PathTopology,
): boolean {
  return isOpen(topology, towardNeighbor) === isOpen(neighborTopology, opposite(towardNeighbor));
}

/** Structural validity: every opening belongs to exactly one segment, no duplicates. */
export function isValidTopology(topology: PathTopology): boolean {
  const flat = topology.segments.flat();
  return (
    flat.length === topology.openings.length &&
    new Set(flat).size === flat.length &&
    flat.every((d) => topology.openings.includes(d))
  );
}
