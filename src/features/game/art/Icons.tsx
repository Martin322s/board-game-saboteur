import type { Role, Tool } from '../../../domain/index.ts';

/** Original, simple line/shape icons (24×24). Decorative: callers provide text labels. */
type IconProps = { className?: string | undefined };

export function DrillIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <rect x={3} y={8} width={8} height={7} rx={1.5} fill="currentColor" fillOpacity={0.25} />
      <path d="M11 11.5h3" />
      <path d="M14 9.5l7 2-7 2z" fill="currentColor" />
      <path d="M15.5 10.2l1 2.6M17.5 10.8l1 1.9" />
      <path d="M5 15v4h4" />
    </svg>
  );
}

export function LampIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <path d="M9 4h6M12 2v2" />
      <path d="M8 6h8l-1 10H9z" fill="currentColor" fillOpacity={0.2} />
      <circle cx={12} cy={11} r={2.2} fill="currentColor" />
      <path d="M7 19h10M9 16v3M15 16v3" />
    </svg>
  );
}

export function RopeIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <ellipse cx={11} cy={12} rx={7} ry={5} />
      <ellipse cx={11} cy={12} rx={4} ry={2.6} />
      <path d="M17.5 14c2 1 3 3 3 5" />
    </svg>
  );
}

export function ToolIcon({ tool, className }: { tool: Tool; className?: string | undefined }) {
  if (tool === 'DRILL') return <DrillIcon className={className} />;
  if (tool === 'LAMP') return <LampIcon className={className} />;
  return <RopeIcon className={className} />;
}

export function CrackMark({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 3l6 7-3 3 6 8M14 3l-2 5 4 3-2 3 5 5" />
    </svg>
  );
}

export function WrenchMark({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.5 5.5a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 0-2-2z" />
    </svg>
  );
}

export function EyeIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx={12} cy={12} r={3} fill="currentColor" />
    </svg>
  );
}

export function RocksIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M3 20l3-6 4 2 2-5 4 3 2-3 3 9z" fillOpacity={0.85} />
      <path d="M8 4l2 2-2 2-2-2zM15 3l1.5 1.5L15 6l-1.5-1.5zM12 7l1 1-1 1-1-1z" />
    </svg>
  );
}

export function GoldIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M3 18l3-6h5l3 6z" fill="#ffd166" stroke="#a16207" />
      <path d="M11 18l3-6h5l3 6z" fill="#fbbf24" stroke="#a16207" />
      <path d="M7 12l3-6h5l3 6z" fill="#fde68a" stroke="#a16207" />
    </svg>
  );
}

export function CrownIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M3 18h18l-1.5-10-4.5 4-3-6-3 6-4.5-4z" />
    </svg>
  );
}

/** Role emblems: a helmeted dwarf with a lamp; a hooded figure with a lit fuse. */
export function RoleEmblem({ role, className }: { role: Role; className?: string }) {
  if (role === 'MINER') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
        <circle cx={32} cy={32} r={30} fill="#24483f" stroke="#8dd0a7" strokeWidth={2} />
        <path d="M16 30a16 14 0 0 1 32 0z" fill="#7693a1" stroke="#263d4b" strokeWidth={2} />
        <rect x={28} y={20} width={8} height={6} rx={2} fill="#e9eef0" />
        <circle cx={32} cy={36} r={9} fill="#f5d0a9" />
        <path d="M21 38c2 14 20 14 22 0-4 4-18 4-22 0z" fill="#b45309" />
        <circle cx={28.5} cy={35} r={1.5} fill="#1c1917" />
        <circle cx={35.5} cy={35} r={1.5} fill="#1c1917" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <circle cx={32} cy={32} r={30} fill="#433846" stroke="#ff9a9e" strokeWidth={2} />
      <path
        d="M18 50c0-20 6-32 14-34 8 2 14 14 14 34z"
        fill="#785368"
        stroke="#252b3b"
        strokeWidth={2}
      />
      <path d="M25 34c2-5 12-5 14 0-2 6-12 6-14 0z" fill="#0f0b12" />
      <circle cx={29} cy={33} r={1.4} fill="#f97316" />
      <circle cx={35} cy={33} r={1.4} fill="#f97316" />
      <path d="M44 14c2 2 4 1 6-1" stroke="#f97316" strokeWidth={2} fill="none" />
      <circle cx={51} cy={12} r={2.5} fill="#fde047" />
    </svg>
  );
}
