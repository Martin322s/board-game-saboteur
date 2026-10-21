import { describe, expect, it } from 'vitest';
import { pathTopology } from '../cards/catalog.ts';
import type { PathTypeId } from '../cards/types.ts';
import { DECK_CATALOG } from '../config/deck.ts';
import { createSeededRng, nextInt } from '../rng/rng.ts';
import { DESTINATION_COORDS, START_COORD } from '../config/board.ts';
import { boardWith, eastLine, path } from '../testing/builders.ts';
import {
  boardCoords,
  cellAt,
  createInitialBoard,
  isWithinBounds,
  placePath,
  removePath,
} from './board.ts';
import { neighbor, opposite, rotateDirection, sortDirections } from './direction.ts';
import { checkPathPlacement, legalPlacements } from './placement.ts';
import { computeReachability, isCellReached, isOpeningReached } from './reachability.ts';
import {
  areInternallyConnected,
  edgesMatch,
  isOpen,
  rotateTopology,
  segmentIndexOf,
} from './topology.ts';

describe('geometry', () => {
  it.each([
    ['N', 'S', { x: 0, y: -1 }],
    ['E', 'W', { x: 1, y: 0 }],
    ['S', 'N', { x: 0, y: 1 }],
    ['W', 'E', { x: -1, y: 0 }],
  ] as const)('%s: opposite %s, neighbour %o (y grows south)', (d, opp, delta) => {
    expect(opposite(d)).toBe(opp);
    expect(neighbor({ x: 0, y: 0 }, d)).toEqual(delta);
    expect(rotateDirection(d, 180)).toBe(opp);
    expect(rotateDirection(d, 0)).toBe(d);
  });

  it('uses the approved fixed cells and bounds', () => {
    expect(START_COORD).toEqual({ x: 0, y: 0 });
    expect(DESTINATION_COORDS).toEqual([
      { x: 8, y: -2 },
      { x: 8, y: 0 },
      { x: 8, y: 2 },
    ]);
    expect(boardCoords()).toHaveLength(5 * 9);
    expect(DESTINATION_COORDS[1].x - START_COORD.x - 1).toBe(7);
    for (const c of [
      { x: 0, y: -2 },
      { x: 8, y: 2 },
    ])
      expect(isWithinBounds(c)).toBe(true);
    for (const c of [
      { x: -1, y: 0 },
      { x: 9, y: 0 },
      { x: 0, y: 3 },
      { x: 0, y: -3 },
      { x: 0.5, y: 0 },
    ]) {
      expect(isWithinBounds(c)).toBe(false);
    }
    const board = createInitialBoard();
    expect(cellAt(board, { x: 0, y: 0 }).kind).toBe('START');
    expect(cellAt(board, { x: 8, y: 2 })).toMatchObject({
      kind: 'DESTINATION',
      destination: { slot: 2, revealed: null },
    });
  });
});

describe('topology', () => {
  it('rotates 180° by swapping N↔S and E↔W', () => {
    expect(pathTopology('PATH_T_EWS', 180).openings).toEqual(['N', 'E', 'W']);
    expect(pathTopology('PATH_CORNER_SE', 180).openings).toEqual(['N', 'W']);
    expect(pathTopology('DEAD_END_E', 180).openings).toEqual(['W']);
    const cross = pathTopology('PATH_CROSS', 0);
    expect(rotateTopology(cross, 180)).toEqual(cross);
  });

  it('distinguishes connected sides from dead-end sides', () => {
    const t = pathTopology('PATH_T_NSE', 0);
    const d = pathTopology('DEAD_T_NSE', 0);
    expect(areInternallyConnected(t, 'N', 'E')).toBe(true);
    expect(areInternallyConnected(d, 'N', 'E')).toBe(false);
    expect(isOpen(d, 'N') && !isOpen(d, 'W')).toBe(true);
    expect(segmentIndexOf(t, 'W')).toBe(-1);
    expect(rotateTopology(d, 180).segments).toEqual([['N'], ['S'], ['W']]);
  });

  it('matches edges only when both facing sides agree', () => {
    const ew = pathTopology('PATH_STRAIGHT_EW', 0);
    const ns = pathTopology('PATH_STRAIGHT_NS', 0);
    expect(edgesMatch(ew, 'E', ew)).toBe(true); // open–open
    expect(edgesMatch(ns, 'E', ns)).toBe(true); // closed–closed
    expect(edgesMatch(ew, 'E', ns)).toBe(false); // open–closed
  });
});

describe('connectivity', () => {
  const reached = (board: ReturnType<typeof boardWith>, x: number, y: number) =>
    isCellReached(computeReachability(board), { x, y });

  it('follows a straight route and a branch', () => {
    const board = boardWith([
      ...eastLine(2),
      path('PATH_CROSS', 3, 0),
      path('PATH_STRAIGHT_NS', 3, -1),
    ]);
    const r = computeReachability(board);
    for (const [x, y] of [
      [1, 0],
      [2, 0],
      [3, 0],
      [3, -1],
    ] as const)
      expect(reached(board, x, y)).toBe(true);
    expect(isOpeningReached(board, r, { x: 3, y: -1 }, 'N')).toBe(true);
  });

  it('stops at a dead end and ignores disconnected cards', () => {
    const board = boardWith([
      path('DEAD_STRAIGHT_EW', 1, 0),
      path('PATH_STRAIGHT_EW', 2, 0),
      path('PATH_CROSS', 4, 2),
    ]);
    const r = computeReachability(board);
    expect(isOpeningReached(board, r, { x: 1, y: 0 }, 'W')).toBe(true);
    expect(isOpeningReached(board, r, { x: 1, y: 0 }, 'E')).toBe(false);
    expect(reached(board, 2, 0)).toBe(false);
    expect(reached(board, 4, 2)).toBe(false);
  });

  it('detects a reached hidden destination without traversing it', () => {
    expect(computeReachability(boardWith(eastLine(6))).touchedHiddenDestinations).toEqual([]);
    const board = boardWith([...eastLine(7), path('PATH_STRAIGHT_NS', 8, 1)]);
    const r = computeReachability(board);
    expect(r.touchedHiddenDestinations).toEqual([1]);
    expect(reached(board, 8, 1)).toBe(false);
  });

  it('traverses a revealed destination as fully open', () => {
    const board = boardWith([...eastLine(7), path('PATH_STRAIGHT_NS', 8, 1)], { 1: 'EMPTY' });
    expect(reached(board, 8, 1)).toBe(true);
    expect(computeReachability(board).touchedHiddenDestinations).toEqual([2]);
  });

  it('one network can touch several destinations at once', () => {
    const board = boardWith([
      ...eastLine(6),
      path('PATH_CROSS', 7, 0), // E faces slot 1
      path('PATH_STRAIGHT_NS', 7, 1),
      path('PATH_T_NSE', 7, 2), // E faces slot 2
    ]);
    expect(computeReachability(board).touchedHiddenDestinations).toEqual([1, 2]);
  });
});

describe('placement validation', () => {
  const line = boardWith([...eastLine(3), path('PATH_CROSS', 5, -2)]);

  it('accepts a legal placement', () => {
    expect(checkPathPlacement(line, 'PATH_STRAIGHT_EW', { x: 4, y: 0 }, 0)).toEqual({
      legal: true,
    });
    expect(checkPathPlacement(line, 'PATH_CORNER_SW', { x: 4, y: 0 }, 0)).toEqual({ legal: true });
  });

  it.each([
    ['INVALID_ROTATION', 'PATH_STRAIGHT_EW', 4, 0, 90],
    ['OUT_OF_BOUNDS', 'PATH_STRAIGHT_EW', 9, 0, 0],
    ['OUT_OF_BOUNDS', 'PATH_STRAIGHT_EW', -1, 0, 0],
    ['OUT_OF_BOUNDS', 'PATH_STRAIGHT_NS', 0, -3, 0],
    ['OUT_OF_BOUNDS', 'PATH_STRAIGHT_NS', 0, 3, 0],
    ['OUT_OF_BOUNDS', 'PATH_STRAIGHT_EW', 4.5, 0, 0],
    ['CELL_OCCUPIED', 'PATH_CROSS', 0, 0, 0], // the entrance
    ['CELL_OCCUPIED', 'PATH_CROSS', 8, 0, 0], // a destination
    ['CELL_OCCUPIED', 'PATH_CROSS', 2, 0, 0], // an existing path
    ['EDGE_MISMATCH', 'PATH_STRAIGHT_NS', 4, 0, 0], // closed W faces open E
    ['NOT_CONNECTED', 'PATH_CROSS', 6, 2, 0], // no neighbours at all
    ['NOT_CONNECTED', 'PATH_CROSS', 5, -1, 0], // touches only an orphan card
  ] as const)('%s for %s at (%d,%d) rot %d', (reason, typeId, x, y, rotation) => {
    expect(checkPathPlacement(line, typeId, { x, y }, rotation)).toEqual({ legal: false, reason });
  });

  it('checks every neighbour, including orphan cards', () => {
    const board = boardWith([...eastLine(3), path('PATH_STRAIGHT_EW', 4, -1)]);
    // CROSS at (4,0): W matches the line, but N is open while the orphan's S is closed.
    expect(checkPathPlacement(board, 'PATH_CROSS', { x: 4, y: 0 }, 0)).toEqual({
      legal: false,
      reason: 'EDGE_MISMATCH',
    });
  });

  it('cannot extend through a dead end', () => {
    const board = boardWith([path('DEAD_STRAIGHT_EW', 1, 0)]);
    expect(checkPathPlacement(board, 'PATH_STRAIGHT_EW', { x: 2, y: 0 }, 0)).toEqual({
      legal: false,
      reason: 'NOT_CONNECTED',
    });
  });

  it('treats destinations as wildcards whether hidden or revealed', () => {
    // CORNER_SW at (7,0) is closed toward the destination at (8,0).
    for (const board of [boardWith(eastLine(6)), boardWith(eastLine(6), { 1: 'EMPTY' })]) {
      expect(checkPathPlacement(board, 'PATH_CORNER_SW', { x: 7, y: 0 }, 0)).toEqual({
        legal: true,
      });
    }
    // A card touching only a hidden destination is not connected.
    expect(checkPathPlacement(boardWith([]), 'PATH_CROSS', { x: 8, y: 1 }, 0)).toEqual({
      legal: false,
      reason: 'NOT_CONNECTED',
    });
  });

  it('legalPlacements equals a brute-force check of every cell', () => {
    const board = boardWith([...eastLine(2), path('PATH_CROSS', 3, 0), path('DEAD_END_S', 3, -1)]);
    for (const typeId of ['PATH_CROSS', 'PATH_T_NSE', 'PATH_CORNER_SW', 'DEAD_END_E'] as const) {
      for (const rotation of [0, 180] as const) {
        const brute = boardCoords().filter(
          (c) => checkPathPlacement(board, typeId, c, rotation).legal,
        );
        expect(legalPlacements(board, typeId, rotation)).toEqual(brute);
      }
    }
    expect(legalPlacements(createInitialBoard(), 'PATH_STRAIGHT_EW', 0)).toEqual([{ x: 1, y: 0 }]);
  });

  it('removing a path card can disconnect cards beyond it', () => {
    const board = removePath(boardWith(eastLine(3)), { x: 2, y: 0 });
    const r = computeReachability(board);
    expect(isCellReached(r, { x: 1, y: 0 })).toBe(true);
    expect(isCellReached(r, { x: 3, y: 0 })).toBe(false);
  });

  it('never traverses or offers cells outside the fixed matrix', () => {
    const board = boardWith([
      path('PATH_CROSS', -1, 0),
      path('PATH_CROSS', 0, -1),
      path('PATH_CROSS', 0, -2),
      path('PATH_CROSS', 0, -3),
    ]);
    const reached = computeReachability(board).reachedCells;
    expect(reached.every((c) => isWithinBounds(c))).toBe(true);
    for (const rotation of [0, 180] as const) {
      expect(legalPlacements(board, 'PATH_CROSS', rotation).every((c) => isWithinBounds(c))).toBe(
        true,
      );
    }
  });
});

describe('edge matching against every occupied neighbour (regression)', () => {
  // Candidate at (4,0) reaches the entrance through its W side via the line (1..3,0).
  const viaLine = (...extra: ReturnType<typeof path>[]) => boardWith([...eastLine(3), ...extra]);
  // Candidate at (3,1) reaches the entrance through its N side via a cross at (3,0).
  const viaCross = (...extra: ReturnType<typeof path>[]) =>
    boardWith([...eastLine(2), path('PATH_CROSS', 3, 0), ...extra]);

  it.each([
    [
      'N/S: candidate N open, neighbour S closed',
      viaLine(path('PATH_STRAIGHT_EW', 4, -1)),
      'PATH_CROSS',
      4,
      0,
    ],
    [
      'N/S: candidate N closed, neighbour S open',
      viaLine(path('PATH_STRAIGHT_NS', 4, -1)),
      'PATH_STRAIGHT_EW',
      4,
      0,
    ],
    [
      'S/N: candidate S open, neighbour N closed',
      viaLine(path('PATH_STRAIGHT_EW', 4, 1)),
      'PATH_CROSS',
      4,
      0,
    ],
    [
      'S/N: candidate S closed, neighbour N open',
      viaLine(path('PATH_STRAIGHT_NS', 4, 1)),
      'PATH_STRAIGHT_EW',
      4,
      0,
    ],
    [
      'E/W: candidate E open, neighbour W closed',
      viaLine(path('PATH_STRAIGHT_NS', 5, 0)),
      'PATH_STRAIGHT_EW',
      4,
      0,
    ],
    [
      'E/W: candidate E closed, neighbour W open',
      viaLine(path('PATH_STRAIGHT_EW', 5, 0)),
      'PATH_CORNER_SW',
      4,
      0,
    ],
    [
      'W/E: candidate W open, neighbour E closed',
      viaCross(path('PATH_STRAIGHT_NS', 2, 1)),
      'PATH_CROSS',
      3,
      1,
    ],
    [
      'W/E: candidate W closed, neighbour E open',
      viaCross(path('PATH_STRAIGHT_EW', 2, 1)),
      'PATH_STRAIGHT_NS',
      3,
      1,
    ],
  ] as const)('rejects %s', (_name, board, typeId, x, y) => {
    expect(checkPathPlacement(board, typeId, { x, y }, 0)).toEqual({
      legal: false,
      reason: 'EDGE_MISMATCH',
    });
    expect(legalPlacements(board, typeId, 0)).not.toContainEqual({ x, y });
  });

  it('accepts OPEN→OPEN and CLOSED→CLOSED', () => {
    expect(
      checkPathPlacement(viaLine(path('PATH_STRAIGHT_NS', 4, -1)), 'PATH_CROSS', { x: 4, y: 0 }, 0)
        .legal,
    ).toBe(true);
    expect(
      checkPathPlacement(
        viaLine(path('PATH_STRAIGHT_EW', 4, -1)),
        'PATH_STRAIGHT_EW',
        { x: 4, y: 0 },
        0,
      ).legal,
    ).toBe(true);
  });

  it('requires a match with EVERY occupied neighbour, not only the connecting one', () => {
    const matching = [
      path('PATH_STRAIGHT_NS', 4, -1),
      path('PATH_STRAIGHT_NS', 4, 1),
      path('PATH_STRAIGHT_EW', 5, 0),
    ];
    expect(checkPathPlacement(viaLine(...matching), 'PATH_CROSS', { x: 4, y: 0 }, 0).legal).toBe(
      true,
    );
    const mismatching = [
      path('PATH_STRAIGHT_EW', 4, -1),
      path('PATH_STRAIGHT_EW', 4, 1),
      path('PATH_STRAIGHT_NS', 5, 0),
    ];
    for (let i = 0; i < matching.length; i++) {
      const neighbours = matching.map((m, j) => (j === i ? mismatching[i]! : m));
      expect(checkPathPlacement(viaLine(...neighbours), 'PATH_CROSS', { x: 4, y: 0 }, 0)).toEqual({
        legal: false,
        reason: 'EDGE_MISMATCH',
      });
    }
  });

  it('a card at the entrance must match the fully open entrance', () => {
    // STRAIGHT_NS at (1,0) is closed W toward the open entrance.
    expect(checkPathPlacement(boardWith([]), 'PATH_STRAIGHT_NS', { x: 1, y: 0 }, 0)).toEqual({
      legal: false,
      reason: 'EDGE_MISMATCH',
    });
  });

  it('rotation 180° validates with the rotated topology', () => {
    // CORNER_SW is open S+W at 0°, N+E at 180°.
    expect(pathTopology('PATH_CORNER_SW', 180).openings).toEqual(['N', 'E']);
    expect(checkPathPlacement(viaLine(), 'PATH_CORNER_SW', { x: 4, y: 0 }, 0).legal).toBe(true);
    expect(checkPathPlacement(viaLine(), 'PATH_CORNER_SW', { x: 4, y: 0 }, 180)).toEqual({
      legal: false,
      reason: 'EDGE_MISMATCH',
    });
    // DEAD_END_E at 180° opens W only: it matches the line, but a rotated card's closed E
    // side must still match an east neighbour.
    expect(checkPathPlacement(viaLine(), 'DEAD_END_E', { x: 4, y: 0 }, 180).legal).toBe(true);
    expect(
      checkPathPlacement(
        viaLine(path('PATH_STRAIGHT_EW', 5, 0)),
        'DEAD_END_E',
        { x: 4, y: 0 },
        180,
      ),
    ).toEqual({
      legal: false,
      reason: 'EDGE_MISMATCH',
    });
    for (const def of DECK_CATALOG.filter((d) => d.category === 'PATH')) {
      const typeId = def.typeId as PathTypeId;
      expect(pathTopology(typeId, 180).openings).toEqual(
        sortDirections(pathTopology(typeId, 0).openings.map(opposite)),
      );
    }
  });

  it('legalPlacements never offers a placement the authoritative check rejects (random boards)', () => {
    const pathTypes = DECK_CATALOG.filter((d) => d.category === 'PATH').map(
      (d) => d.typeId as PathTypeId,
    );
    for (let game = 0; game < 25; game++) {
      const rng = createSeededRng(`edges-${game}`);
      let board = createInitialBoard();
      for (let step = 0; step < 30; step++) {
        const reach = computeReachability(board);
        const options = pathTypes.flatMap((typeId) =>
          ([0, 180] as const).flatMap((rotation) => {
            const cells = legalPlacements(board, typeId, rotation);
            const brute = boardCoords().filter(
              (c) => checkPathPlacement(board, typeId, c, rotation, reach).legal,
            );
            expect(cells).toEqual(brute);
            return cells.map((c) => ({ typeId, rotation, c }));
          }),
        );
        if (options.length === 0) break;
        const pick = options[nextInt(rng, options.length)]!;
        board = placePath(board, path(pick.typeId, pick.c.x, pick.c.y, pick.rotation));
        // Board invariant: every adjacent pair of entrance/path cells agrees on its shared edge.
        for (const coord of boardCoords()) {
          const cell = cellAt(board, coord);
          if (cell.kind !== 'PATH' && cell.kind !== 'START') continue;
          for (const direction of ['E', 'S'] as const) {
            const other = cellAt(board, neighbor(coord, direction));
            if (other.kind === 'PATH' || other.kind === 'START') {
              expect(edgesMatch(cell.topology, direction, other.topology)).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe('destinations connect only through a real opening (GAME_RULES §4.6)', () => {
  // Destination slot 1 sits at (8,0). Each case places the final card on one side of it,
  // reached from the entrance, with its facing side OPEN or CLOSED.
  const approaches = [
    {
      side: 'west of the destination (card faces E)',
      prefix: eastLine(6),
      at: { x: 7, y: 0 },
      open: ['PATH_STRAIGHT_EW', 0],
      closed: ['PATH_CORNER_SW', 0],
    },
    {
      side: 'north of the destination (card faces S)',
      prefix: [...eastLine(6), path('PATH_CORNER_SE', 7, 0, 180), path('PATH_CORNER_SE', 7, -1)],
      at: { x: 8, y: -1 },
      open: ['PATH_CORNER_SW', 0],
      closed: ['PATH_STRAIGHT_EW', 0],
    },
    {
      side: 'south of the destination (card faces N)',
      prefix: [...eastLine(6), path('PATH_CORNER_SW', 7, 0), path('PATH_CORNER_SW', 7, 1, 180)],
      at: { x: 8, y: 1 },
      open: ['PATH_CORNER_SE', 180],
      closed: ['PATH_STRAIGHT_EW', 0],
    },
  ] as const;

  describe.each(approaches)('$side', ({ prefix, at, open, closed }) => {
    it('OPEN facing side: legal and reaches (reveals) the destination', () => {
      const [typeId, rotation] = open;
      expect(checkPathPlacement(boardWith(prefix), typeId, at, rotation)).toEqual({ legal: true });
      const board = boardWith([...prefix, path(typeId, at.x, at.y, rotation)]);
      expect(computeReachability(board).touchedHiddenDestinations).toEqual([1]);
      const revealed = boardWith([...prefix, path(typeId, at.x, at.y, rotation)], { 1: 'EMPTY' });
      expect(isCellReached(computeReachability(revealed), { x: 8, y: 0 })).toBe(true);
    });

    it('CLOSED facing side: still legal, but never reaches the destination', () => {
      const [typeId, rotation] = closed;
      expect(checkPathPlacement(boardWith(prefix), typeId, at, rotation)).toEqual({ legal: true });
      const board = boardWith([...prefix, path(typeId, at.x, at.y, rotation)]);
      expect(computeReachability(board).touchedHiddenDestinations).toEqual([]);
      // Even an already revealed destination is not entered through a closed side.
      const revealed = boardWith([...prefix, path(typeId, at.x, at.y, rotation)], { 1: 'EMPTY' });
      expect(isCellReached(computeReachability(revealed), { x: 8, y: 0 })).toBe(false);
    });
  });

  it('the fourth (east) side of every destination lies outside the fixed 5×9 board', () => {
    for (const d of DESTINATION_COORDS) expect(isWithinBounds(neighbor(d, 'E'))).toBe(false);
  });

  it('a revealed destination reached only through a closed side does not extend the network', () => {
    // CORNER_SW at (7,0) is closed toward revealed slot 1, so (8,1) cannot connect through it.
    const board = boardWith([...eastLine(6), path('PATH_CORNER_SW', 7, 0)], { 1: 'EMPTY' });
    expect(checkPathPlacement(board, 'PATH_STRAIGHT_NS', { x: 8, y: 1 }, 0)).toEqual({
      legal: false,
      reason: 'NOT_CONNECTED',
    });
  });
});
