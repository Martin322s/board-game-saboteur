import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2.5;
const DRAG_THRESHOLD = 6;
const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Fit `content` (world units) into a viewport with some padding. */
export function fitCamera(content: Rect, viewport: { w: number; h: number }): Camera {
  const k = clampZoom(Math.min(viewport.w / content.w, viewport.h / content.h) * 0.92);
  return {
    k,
    x: viewport.w / 2 - (content.x + content.w / 2) * k,
    y: viewport.h / 2 - (content.y + content.h / 2) * k,
  };
}

/** Centre axes that fit; otherwise keep panning within the board's edges. */
export function clampCamera(
  camera: Camera,
  world: Rect,
  viewport: { w: number; h: number },
): Camera {
  const margin = 32;
  const maxX = margin - world.x * camera.k;
  const maxY = margin - world.y * camera.k;
  const edgeX = viewport.w - margin - (world.x + world.w) * camera.k;
  const edgeY = viewport.h - margin - (world.y + world.h) * camera.k;
  return {
    k: camera.k,
    x:
      world.w * camera.k <= viewport.w
        ? viewport.w / 2 - (world.x + world.w / 2) * camera.k
        : Math.min(maxX, Math.max(edgeX, camera.x)),
    y:
      world.h * camera.k <= viewport.h
        ? viewport.h / 2 - (world.y + world.h / 2) * camera.k
        : Math.min(maxY, Math.max(edgeY, camera.y)),
  };
}

/**
 * Pan (drag), wheel zoom around the cursor, two-finger pinch, +/- and recenter — with plain
 * pointer events and a CSS/SVG transform (no gesture library). Movements beyond a small threshold
 * become pans and suppress the following click, so panning never places a card by accident.
 */
export function useBoardCamera(
  containerRef: RefObject<HTMLDivElement | null>,
  content: Rect,
  world: Rect,
) {
  const viewport = useRef({ w: 800, h: 600 });
  const [camera, setCamera] = useState<Camera>(() => fitCamera(content, viewport.current));
  const cameraRef = useRef(camera);
  const contentRef = useRef(content);
  const followFit = useRef(true);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    start: Camera;
    x: number;
    y: number;
    distance: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    cameraRef.current = camera;
    contentRef.current = content;
  });

  const apply = useCallback(
    (next: Camera) => {
      followFit.current = false;
      setCamera(clampCamera(next, world, viewport.current));
    },
    [world],
  );

  const recenter = useCallback(() => {
    followFit.current = true;
    setCamera(fitCamera(contentRef.current, viewport.current));
  }, []);

  const zoomAt = useCallback(
    (factor: number, px = viewport.current.w / 2, py = viewport.current.h / 2) => {
      const c = cameraRef.current;
      const k = clampZoom(c.k * factor);
      apply({ k, x: px - ((px - c.x) * k) / c.k, y: py - ((py - c.y) * k) / c.k });
    },
    [apply],
  );

  // Follow resizing until the user deliberately pans/zooms; recenter restores automatic fit.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        viewport.current = { w: rect.width, h: rect.height };
        if (followFit.current) {
          setCamera(fitCamera(contentRef.current, viewport.current));
        } else {
          setCamera((c) => clampCamera(c, world, viewport.current));
        }
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, world]);

  // Non-passive wheel listener so the page does not scroll while zooming the board.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [containerRef, zoomAt]);

  const local = (event: React.PointerEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const startGesture = () => {
    const pts = [...pointers.current.values()];
    const mid = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), {
      x: 0,
      y: 0,
    });
    const [a, b] = pts;
    gesture.current = {
      start: cameraRef.current,
      x: mid.x,
      y: mid.y,
      distance: a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0,
      moved: gesture.current?.moved ?? false,
    };
  };

  const handlers = {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      pointers.current.set(event.pointerId, local(event));
      if (pointers.current.size === 1) gesture.current = null;
      startGesture();
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (!pointers.current.has(event.pointerId) || !gesture.current) return;
      pointers.current.set(event.pointerId, local(event));
      const g = gesture.current;
      const pts = [...pointers.current.values()];
      const mid = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), {
        x: 0,
        y: 0,
      });
      const dx = mid.x - g.x;
      const dy = mid.y - g.y;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD && pts.length < 2) return;
      if (!g.moved) {
        g.moved = true;
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      }
      const [a, b] = pts;
      if (a && b && g.distance > 0) {
        const k = clampZoom(g.start.k * (Math.hypot(a.x - b.x, a.y - b.y) / g.distance));
        apply({
          k,
          x: mid.x - ((g.x - g.start.x) * k) / g.start.k,
          y: mid.y - ((g.y - g.start.y) * k) / g.start.k,
        });
      } else {
        apply({ k: g.start.k, x: g.start.x + dx, y: g.start.y + dy });
      }
    },
    onPointerUp: (event: React.PointerEvent) => {
      pointers.current.delete(event.pointerId);
      if (gesture.current?.moved) suppressClick.current = true;
      if (pointers.current.size === 0) gesture.current = null;
      else startGesture();
    },
    onPointerCancel: (event: React.PointerEvent) => {
      pointers.current.delete(event.pointerId);
      gesture.current = null;
    },
    onClickCapture: (event: React.MouseEvent) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        event.stopPropagation();
        event.preventDefault();
      }
    },
  };

  return {
    camera,
    handlers,
    zoomIn: () => zoomAt(1.25),
    zoomOut: () => zoomAt(0.8),
    recenter,
  };
}
