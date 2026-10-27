import { memo, useRef, useState } from 'react';
import {
  BOARD_BOUNDS,
  boardCoords,
  FULLY_OPEN,
  pathTopology,
  START_COORD,
  type Board,
  type Coord,
  type KnownDestination,
  type PathTopology,
} from '../../../domain/index.ts';
import { t } from '../../../i18n/index.ts';
import { GoldIcon, RocksIcon } from '../art/Icons.tsx';
import { TunnelArt } from '../art/TunnelArt.tsx';
import { describeTopology } from '../format.ts';
import { CELL, cellOrigin, destinationArtTopology } from './geometry.ts';
import { useBoardCamera, type Rect } from './useBoardCamera.ts';

const WORLD: Rect = {
  x: 0,
  y: 0,
  w: (BOARD_BOUNDS.maxX - BOARD_BOUNDS.minX + 1) * CELL,
  h: (BOARD_BOUNDS.maxY - BOARD_BOUNDS.minY + 1) * CELL,
};

export interface BoardInteraction {
  /** Legal cells for the selected tunnel card (UX preview of domain legalPlacements). */
  readonly legalCells?: readonly Coord[];
  /** Ghost tunnel shown at the chosen/hovered legal cell. */
  readonly ghost?: PathTopology;
  readonly chosenCell?: Coord | null;
  readonly onCell?: (cell: Coord) => void;
  readonly surveySlots?: readonly number[];
  readonly chosenSlot?: number | null;
  readonly onSlot?: (slot: number) => void;
  readonly collapseCells?: readonly Coord[];
  readonly onCollapse?: (cell: Coord) => void;
}

const MATRIX_CELLS = boardCoords();

const same = (a: Coord | null | undefined, b: Coord) => !!a && a.x === b.x && a.y === b.y;

export const BoardView = memo(function BoardView({
  board,
  interaction = {},
}: {
  board: Board;
  known: readonly KnownDestination[];
  interaction?: BoardInteraction;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { camera, handlers, zoomIn, zoomOut, recenter } = useBoardCamera(
    containerRef,
    WORLD,
    WORLD,
  );
  const [hover, setHover] = useState<Coord | null>(null);
  const {
    legalCells,
    ghost,
    chosenCell,
    onCell,
    surveySlots,
    chosenSlot,
    onSlot,
    collapseCells,
    onCollapse,
  } = interaction;
  const previewCell =
    chosenCell ?? (hover && legalCells?.some((c) => same(hover, c)) ? hover : null);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
        {...handlers}
      >
        <svg className="h-full w-full" role="group" aria-label={t('board.label')}>
          <defs>
            <radialGradient id="board-lantern" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f2b84b" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#f2b84b" stopOpacity={0} />
            </radialGradient>
            <radialGradient id="board-reveal-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffd166" stopOpacity={0.7} />
              <stop offset="100%" stopColor="#ffd166" stopOpacity={0} />
            </radialGradient>
          </defs>
          <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.k})`}>
            {/* A fixed stone playing area with individual card wells. */}
            <rect
              width={WORLD.w}
              height={WORLD.h}
              rx={18}
              fill="#3d5362"
              stroke="#253b49"
              strokeWidth={3}
            />
            <g aria-hidden="true" data-part="matrix">
              {MATRIX_CELLS.map((cell) => {
                const o = cellOrigin(cell);
                return (
                  <rect
                    key={`${cell.x},${cell.y}`}
                    x={o.x + 5}
                    y={o.y + 5}
                    width={90}
                    height={90}
                    rx={10}
                    fill="#536d7e"
                    fillOpacity={0.7}
                    stroke="#6c8697"
                    strokeWidth={1.5}
                  />
                );
              })}
            </g>

            <StartTile />
            {Object.entries(board.paths).map(([key, path]) => {
              const topology = pathTopology(path.typeId, path.rotation);
              const o = cellOrigin(path);
              const target = collapseCells?.some((c) => same(c, path));
              return (
                <g key={key} transform={`translate(${o.x} ${o.y})`}>
                  <g
                    role="img"
                    aria-label={t('board.tunnelAt', {
                      tunnel: describeTopology(topology),
                      x: path.x,
                      y: path.y,
                    })}
                  >
                    <TunnelArt topology={topology} />
                  </g>
                  {target && (
                    <rect
                      role="button"
                      aria-label={t('board.collapseHere', { x: path.x, y: path.y })}
                      x={4}
                      y={4}
                      width={92}
                      height={92}
                      rx={10}
                      fill={
                        same(chosenCell, path)
                          ? 'rgb(248 113 113 / 0.35)'
                          : 'rgb(248 113 113 / 0.12)'
                      }
                      stroke="#f87171"
                      strokeWidth={same(chosenCell, path) ? 6 : 3}
                      strokeDasharray={same(chosenCell, path) ? undefined : '10 6'}
                      className="cursor-pointer"
                      onClick={() => onCollapse?.(path)}
                    />
                  )}
                </g>
              );
            })}
            {board.destinations.map((d) => (
              <DestinationTile
                key={d.slot}
                board={board}
                destination={d}
                targetable={surveySlots?.includes(d.slot) ?? false}
                chosen={chosenSlot === d.slot}
                onSelect={() => onSlot?.(d.slot)}
              />
            ))}

            {legalCells?.map((cell) => {
              const o = cellOrigin(cell);
              return (
                <rect
                  key={`${cell.x},${cell.y}`}
                  role="button"
                  aria-label={t('board.placeHere', { x: cell.x, y: cell.y })}
                  x={o.x + 6}
                  y={o.y + 6}
                  width={CELL - 12}
                  height={CELL - 12}
                  rx={12}
                  fill="rgb(168 220 232 / 0.20)"
                  stroke="#a8dce8"
                  strokeWidth={3}
                  strokeDasharray="12 8"
                  className="legal-cell cursor-pointer"
                  onPointerEnter={() => setHover(cell)}
                  onPointerLeave={() => setHover(null)}
                  onClick={() => onCell?.(cell)}
                />
              );
            })}
            {ghost && previewCell && (
              <g
                transform={`translate(${cellOrigin(previewCell).x} ${cellOrigin(previewCell).y})`}
                pointerEvents="none"
              >
                <TunnelArt topology={ghost} ghost />
                <rect
                  x={3}
                  y={3}
                  width={94}
                  height={94}
                  rx={10}
                  fill="none"
                  stroke="#a8dce8"
                  strokeWidth={5}
                />
              </g>
            )}
          </g>
        </svg>
      </div>

      <div className="absolute right-3 bottom-3 flex flex-col gap-2">
        <button
          type="button"
          onClick={zoomIn}
          aria-label={t('board.zoomIn')}
          className="mine-panel h-11 w-11 rounded-full border text-xl font-bold text-fg shadow-sm"
        >
          +
        </button>
        <button
          type="button"
          onClick={zoomOut}
          aria-label={t('board.zoomOut')}
          className="mine-panel h-11 w-11 rounded-full border text-xl font-bold text-fg shadow-sm"
        >
          −
        </button>
        <button
          type="button"
          onClick={recenter}
          className="mine-panel rounded-full border px-3 py-2 text-sm font-semibold text-fg shadow-sm"
        >
          {t('board.center')}
        </button>
      </div>
    </div>
  );
});

function StartTile() {
  const o = cellOrigin(START_COORD);
  return (
    <g transform={`translate(${o.x} ${o.y})`} role="img" aria-label={t('board.start')}>
      <circle cx={50} cy={50} r={120} fill="url(#board-lantern)" />
      <TunnelArt topology={FULLY_OPEN} />
      {/* timber portal of the mine entrance */}
      <path
        d="M22 84 V40 Q50 8 78 40 V84"
        fill="none"
        stroke="#8098a6"
        strokeWidth={9}
        strokeLinejoin="round"
      />
      <path d="M22 84 V40 Q50 8 78 40 V84" fill="none" stroke="#203644" strokeWidth={3} />
      <circle cx={50} cy={30} r={6} fill="#ffd166" />
      <circle cx={50} cy={30} r={11} fill="#ffd166" opacity={0.25} />
    </g>
  );
}

/**
 * Destination tile. A HIDDEN destination renders identically for every slot: its identity is
 * not in the public snapshot, so nothing (class, data attribute, label, asset URL) can leak it.
 * Survey knowledge stays in the private survey dialog; a hidden card back never varies by identity.
 */
function DestinationTile({
  board,
  destination,
  targetable,
  chosen,
  onSelect,
}: {
  board: Board;
  destination: Board['destinations'][number];
  targetable: boolean;
  chosen: boolean;
  onSelect: () => void;
}) {
  const o = cellOrigin(destination);
  const slotNo = destination.slot + 1;
  const revealed = destination.revealed;
  const label = revealed
    ? `${t(`destination.${revealed}`)} (${t('board.slot', { slot: slotNo })})`
    : `${t('destination.hidden')} (${t('board.slot', { slot: slotNo })})`;

  return (
    <g transform={`translate(${o.x} ${o.y})`}>
      <g role="img" aria-label={label}>
        {revealed ? (
          <>
            {revealed === 'TREASURE' && (
              <circle cx={50} cy={50} r={90} fill="url(#board-reveal-glow)" />
            )}
            <TunnelArt topology={destinationArtTopology(board, destination)} chamber />
            <svg x={22} y={22} width={56} height={56} className="text-slate-700">
              {revealed === 'TREASURE' ? <GoldIcon /> : <RocksIcon />}
            </svg>
          </>
        ) : (
          <>
            <rect
              x={2}
              y={2}
              width={96}
              height={96}
              rx={10}
              fill="#466c84"
              stroke="#203c4e"
              strokeWidth={3}
            />
            <path d="M50 10 L90 50 L50 90 L10 50 Z" fill="none" stroke="#9ab7c7" strokeWidth={3} />
            <path
              d="M50 26 L74 50 L50 74 L26 50 Z"
              fill="#34546c"
              stroke="#89aabf"
              strokeWidth={2}
            />
            <text x={50} y={60} textAnchor="middle" fontSize={30} fontWeight={700} fill="#e5edf2">
              ?
            </text>
          </>
        )}
      </g>
      {targetable && (
        <rect
          role="button"
          aria-label={t('board.surveyHere', { slot: slotNo })}
          x={-2}
          y={-2}
          width={104}
          height={104}
          rx={14}
          fill={chosen ? 'rgb(168 220 232 / 0.25)' : 'rgb(168 220 232 / 0.08)'}
          stroke="#a8dce8"
          strokeWidth={chosen ? 7 : 4}
          strokeDasharray={chosen ? undefined : '12 8'}
          className="legal-cell cursor-pointer"
          onClick={onSelect}
        />
      )}
    </g>
  );
}
