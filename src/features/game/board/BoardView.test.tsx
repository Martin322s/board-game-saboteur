import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  createInitialBoard,
  placePath,
  revealDestination,
  type PathTypeId,
} from '../../../domain/index.ts';
import { BoardView } from './BoardView.tsx';
import { destinationArtTopology } from './geometry.ts';

describe('fixed matrix renderer and destination privacy', () => {
  it('draws exactly 45 aligned card wells in five rows and nine columns', () => {
    const { container } = render(<BoardView board={createInitialBoard()} known={[]} />);
    const cells = [...container.querySelectorAll('[data-part="matrix"] rect')];
    expect(cells).toHaveLength(45);
    expect(new Set(cells.map((c) => c.getAttribute('x'))).size).toBe(9);
    expect(new Set(cells.map((c) => c.getAttribute('y'))).size).toBe(5);
    expect(screen.getByRole('img', { name: 'Вход на мината' })).toBeInTheDocument();
  });

  it('keeps every hidden card SVG identical even after private survey knowledge changes', () => {
    const board = createInitialBoard();
    const { rerender } = render(<BoardView board={board} known={[]} />);
    const backs = () => screen.getAllByRole('img', { name: /^Неразкрита цел/ });
    const before = backs().map((card) => card.innerHTML);
    expect(new Set(before).size).toBe(1);
    rerender(<BoardView board={board} known={[{ slot: 1, identity: 'TREASURE' }]} />);
    expect(backs().map((card) => card.innerHTML)).toEqual(before);
    expect(backs().every((card) => !/gold|treasure|злато/i.test(card.outerHTML))).toBe(true);
    rerender(<BoardView board={revealDestination(board, 1, 'TREASURE')} known={[]} />);
    expect(backs()).toHaveLength(2);
    expect(screen.getByRole('img', { name: /Злато/ })).toBeInTheDocument();
  });
});

describe('revealed destinations never draw a mouth against a closed neighbour', () => {
  // Real local game: CORNER_SW (open S+W, closed N) at (8,-1) under destination slot 0 (8,-2),
  // which was already revealed. Legal (destinations are edge wildcards, GAME_RULES §4.6), but
  // the old fully-open drawing showed an open S mouth touching the corner's closed N side.
  const placed = (typeId: PathTypeId, x: number, y: number) => ({
    cardId: `c${x}${y}`,
    typeId,
    rotation: 0 as const,
    x,
    y,
    placedBy: 'p',
    placedOnTurn: 1,
  });
  const board = (...paths: ReturnType<typeof placed>[]) =>
    revealDestination(paths.reduce(placePath, createInitialBoard()), 0, 'EMPTY');

  it('opens only toward neighbours whose facing side is open', () => {
    const b = board(placed('PATH_CORNER_SW', 8, -1), placed('PATH_STRAIGHT_EW', 7, -2));
    expect(destinationArtTopology(b, { x: 8, y: -2 }).openings).toEqual(['W']);
    const b2 = board(placed('PATH_STRAIGHT_NS', 8, -1));
    expect(destinationArtTopology(b2, { x: 8, y: -2 }).openings).toEqual(['S']);
  });

  it('renders that shape on the board', () => {
    render(
      <BoardView
        board={board(placed('PATH_CORNER_SW', 8, -1), placed('PATH_STRAIGHT_EW', 7, -2))}
        known={[]}
      />,
    );
    const tile = screen.getByRole('img', { name: /^Празна цел \(цел 1\)/ });
    const mouths = [...tile.querySelectorAll('[data-part="passage"]')].map(
      (l) => `${l.getAttribute('x1')},${l.getAttribute('y1')}`,
    );
    expect(mouths).toEqual(['0,50']); // west only; nothing at the south edge (50,100)
  });
});
