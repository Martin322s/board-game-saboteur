import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DECK_CATALOG,
  pathTopology,
  sortDirections,
  type Direction,
  type PathTopology,
  type PathTypeId,
} from '../../../domain/index.ts';
import { TunnelArt } from './TunnelArt.tsx';

const EDGE_POINT: Record<string, Direction> = {
  '50,0': 'N',
  '100,50': 'E',
  '50,100': 'S',
  '0,50': 'W',
};

/** Read back from the SVG which sides are drawn open, how many blockers and hubs. */
function drawnShape(topology: PathTopology, chamber = false) {
  const { container } = render(
    <svg>
      <TunnelArt topology={topology} chamber={chamber} />
    </svg>,
  );
  const mouths = [...container.querySelectorAll('[data-part="passage"]')].map((line) => {
    const side = EDGE_POINT[`${line.getAttribute('x1')},${line.getAttribute('y1')}`];
    if (!side) throw new Error('passage does not start at an edge midpoint');
    return side;
  });
  return {
    openings: sortDirections(mouths),
    mouthCount: mouths.length,
    blockers: container.querySelectorAll('[data-part="blocker"]').length,
    hubs: container.querySelectorAll('[data-part="hub"]').length,
  };
}

const PATH_TYPES = DECK_CATALOG.filter((d) => d.category === 'PATH').map(
  (d) => d.typeId as PathTypeId,
);

describe('TunnelArt draws exactly the domain topology', () => {
  it.each(
    PATH_TYPES.flatMap((typeId) =>
      ([0, 180] as const).map((rotation) => [typeId, rotation] as const),
    ),
  )('%s at %d°', (typeId, rotation) => {
    const topology = pathTopology(typeId, rotation);
    const drawn = drawnShape(topology);
    expect(drawn.openings).toEqual(topology.openings); // open sides == domain openings
    expect(drawn.mouthCount).toBe(topology.openings.length); // one mouth per side, no extras
    expect(drawn.blockers).toBe(topology.segments.filter((s) => s.length === 1).length);
    expect(drawn.hubs).toBe(topology.segments.filter((s) => s.length >= 2).length);
  });
});
