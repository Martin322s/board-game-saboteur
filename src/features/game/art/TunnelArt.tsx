import { memo } from 'react';
import type { Direction, PathTopology } from '../../../domain/index.ts';
import { describeTopology } from '../format.ts';

/**
 * Procedural tunnel drawing generated ONLY from the domain topology (openings + segments).
 * - A segment with ≥ 2 openings is one connected passage meeting at a hub.
 * - A single-opening segment is a dead end: the passage stops at a rubble blocker.
 * So the picture never shows a connection the rules do not have. (v1 has no cards with two
 * independent multi-opening segments; such "bridge" cards would need a dedicated renderer.)
 * Coordinates are in a 100×100 tile space.
 */
const EDGE: Readonly<Record<Direction, readonly [number, number]>> = {
  N: [50, 0],
  E: [100, 50],
  S: [50, 100],
  W: [0, 50],
};

/** Point between the edge midpoint (t = 0) and the tile centre (t = 1). */
function along(direction: Direction, t: number): [number, number] {
  const [x, y] = EDGE[direction];
  return [x + (50 - x) * t, y + (50 - y) * t];
}

const RIM = '#283e4d';
const PASSAGE = '#e9eef0';
const EARTH = '#7893a2';

export const TunnelArt = memo(function TunnelArt({
  topology,
  ghost = false,
  chamber = false,
}: {
  topology: PathTopology;
  ghost?: boolean;
  /** Every opening runs into a central chamber, even a single one (revealed destinations). */
  chamber?: boolean;
}) {
  const connected = chamber
    ? topology.openings.length > 0
      ? [topology.openings]
      : []
    : topology.segments.filter((s) => s.length >= 2);
  const deadEnds = chamber
    ? []
    : topology.segments.filter((s) => s.length === 1).map((s) => s[0] as Direction);
  const deadEndDepth = 0.56;

  return (
    <g opacity={ghost ? 0.75 : 1}>
      <rect
        x={2}
        y={2}
        width={96}
        height={96}
        rx={10}
        fill={EARTH}
        stroke="#263d4b"
        strokeWidth={3}
      />
      {/* deterministic stone flecks */}
      <g fill="#526d7c" opacity={0.7}>
        <circle cx={18} cy={22} r={3} />
        <circle cx={80} cy={16} r={2.5} />
        <circle cx={84} cy={78} r={3.5} />
        <circle cx={22} cy={82} r={2} />
      </g>
      {/* dark rock rims first, pale passages on top */}
      <g stroke={RIM} strokeWidth={38} strokeLinecap="butt" data-part="rim">
        {connected.flatMap((segment, i) =>
          segment.map((d) => {
            const [x1, y1] = along(d, 0);
            return <line key={`r${i}${d}`} x1={x1} y1={y1} x2={50} y2={50} />;
          }),
        )}
        {deadEnds.map((d) => {
          const [x1, y1] = along(d, 0);
          const [x2, y2] = along(d, deadEndDepth);
          return <line key={`rd${d}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </g>
      {connected.map((_segment, i) => (
        <circle key={`hr${i}`} cx={50} cy={50} r={19} fill={RIM} />
      ))}
      <g stroke={PASSAGE} strokeWidth={26} strokeLinecap="butt">
        {connected.flatMap((segment, i) =>
          segment.map((d) => {
            const [x1, y1] = along(d, 0);
            return <line key={`p${i}${d}`} data-part="passage" x1={x1} y1={y1} x2={50} y2={50} />;
          }),
        )}
        {deadEnds.map((d) => {
          const [x1, y1] = along(d, 0);
          const [x2, y2] = along(d, deadEndDepth - 0.08);
          return <line key={`pd${d}`} data-part="passage" x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </g>
      {connected.map((_segment, i) => (
        <circle key={`h${i}`} data-part="hub" cx={50} cy={50} r={13} fill={PASSAGE} />
      ))}
      {deadEnds.map((d) => {
        const [x, y] = along(d, deadEndDepth);
        return (
          <g key={`b${d}`} data-part="blocker">
            <circle cx={x} cy={y} r={11} fill="#9fadb6" stroke="#273d4b" strokeWidth={2} />
            <path
              d={`M${x - 6} ${y - 6} L${x + 6} ${y + 6} M${x + 6} ${y - 6} L${x - 6} ${y + 6}`}
              stroke="#273d4b"
              strokeWidth={3}
            />
          </g>
        );
      })}
      {/* timber supports on the passage mouths */}
      <g stroke="#496675" strokeWidth={3}>
        {topology.openings.map((d) => {
          const [x, y] = along(d, 0.04);
          const horizontal = d === 'N' || d === 'S';
          return horizontal ? (
            <line key={`t${d}`} x1={x - 16} y1={y} x2={x + 16} y2={y} />
          ) : (
            <line key={`t${d}`} x1={x} y1={y - 16} x2={x} y2={y + 16} />
          );
        })}
      </g>
    </g>
  );
});

/** Standalone tile (hand cards, previews). */
export function TunnelTile({
  topology,
  className = '',
  ghost = false,
}: {
  topology: PathTopology;
  className?: string;
  ghost?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={describeTopology(topology)}
      className={className}
    >
      <TunnelArt topology={topology} ghost={ghost} />
    </svg>
  );
}
