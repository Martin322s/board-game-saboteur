import { describe, expect, it } from 'vitest';
import { clampCamera, fitCamera } from './useBoardCamera.ts';

const world = { x: 0, y: 0, w: 900, h: 500 };

describe('fixed matrix camera', () => {
  it.each([
    { w: 390, h: 450 },
    { w: 1078, h: 500 },
    { w: 1632, h: 820 },
  ])('fits the entire board inside a $w × $h panel', (viewport) => {
    const camera = fitCamera(world, viewport);
    expect(camera.x).toBeGreaterThan(0);
    expect(camera.y).toBeGreaterThan(0);
    expect(camera.x + world.w * camera.k).toBeLessThan(viewport.w);
    expect(camera.y + world.h * camera.k).toBeLessThan(viewport.h);
  });

  it('keeps a fitted board centred rather than dragging it off screen', () => {
    const viewport = { w: 1078, h: 500 };
    const fitted = fitCamera(world, viewport);
    expect(clampCamera({ ...fitted, x: -1000, y: 1000 }, world, viewport)).toEqual(fitted);
  });

  it('allows phone panning at enlarged zoom but stops at the matrix edges', () => {
    const viewport = { w: 390, h: 450 };
    expect(clampCamera({ k: 1, x: 1000, y: -1000 }, world, viewport)).toEqual({
      k: 1,
      x: 32,
      y: -82,
    });
    expect(clampCamera({ k: 1, x: -1000, y: 1000 }, world, viewport)).toEqual({
      k: 1,
      x: -542,
      y: 32,
    });
  });
});
