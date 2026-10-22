/**
 * Test-only builders for domain tests. Pure domain code (no vitest import) so it stays within
 * the portability rules; it is excluded from the future Edge Function sync.
 */
import {
  createInitialBoard,
  placePath,
  revealDestination,
  type Board,
  type PlacedPath,
} from '../board/board.ts';
import type { Rotation } from '../board/direction.ts';
import type { CardInstance, CardTypeId, PathTypeId } from '../cards/types.ts';
import { addCardToHand, EMPTY_HAND, type HandState } from '../hands/hand.ts';
import { createRound } from '../game/createRound.ts';
import type { RoundPlayer, RoundState } from '../game/types.ts';
import type { DestinationIdentity, DestinationSlot, PlayerId } from '../primitives.ts';

export const NOW = 1_700_000_000_000;

export function path(typeId: PathTypeId, x: number, y: number, rotation: Rotation = 0): PlacedPath {
  return { cardId: `b:${x},${y}`, typeId, rotation, x, y, placedBy: 'p0', placedOnTurn: 0 };
}

export function boardWith(
  paths: readonly PlacedPath[],
  revealed: Partial<Record<DestinationSlot, DestinationIdentity>> = {},
): Board {
  let board = paths.reduce(placePath, createInitialBoard());
  for (const [slot, identity] of Object.entries(revealed)) {
    board = revealDestination(board, Number(slot) as DestinationSlot, identity);
  }
  return board;
}

/** Straight east–west tunnel from (1,0) to (toX,0). */
export function eastLine(toX: number): PlacedPath[] {
  return Array.from({ length: toX }, (_, i) => path('PATH_STRAIGHT_EW', i + 1, 0));
}

export function handOf(prefix: string, typeIds: readonly CardTypeId[]): HandState {
  return typeIds
    .map((typeId, i): CardInstance => ({ id: `${prefix}:${i}`, typeId }))
    .reduce(addCardToHand, EMPTY_HAND);
}

/** A real round from createRound with players p0..p{n-1} at seats 0..n-1. */
export function baseRound(playerCount = 3, seed = 'test-seed'): RoundState {
  const created = createRound({
    players: Array.from({ length: playerCount }, (_, i) => ({ playerId: `p${i}`, seat: i })),
    roundNo: 1,
    seed,
    previousStartingSeat: null,
    now: NOW,
  });
  if (!created.ok) throw new Error(created.error.code);
  return created.value.state;
}

export function patchPlayer(
  state: RoundState,
  playerId: PlayerId,
  patch: Partial<RoundPlayer>,
): RoundState {
  return {
    ...state,
    players: state.players.map((p) => (p.playerId === playerId ? { ...p, ...patch } : p)),
  };
}

export function withHand(
  state: RoundState,
  playerId: PlayerId,
  typeIds: readonly CardTypeId[],
): RoundState {
  return patchPlayer(state, playerId, { hand: handOf(playerId, typeIds) });
}

/**
 * A controlled 3-player round: p0 active, known roles and destinations, a small known draw pile,
 * and each player's hand replaced by the given card types (ids "<playerId>:<index>").
 */
export function scenario(
  options: {
    readonly hands?: Partial<Record<PlayerId, readonly CardTypeId[]>>;
    readonly board?: Board;
    readonly destinations?: readonly DestinationIdentity[];
    readonly drawPile?: readonly CardTypeId[];
    readonly playerCount?: number;
  } = {},
): RoundState {
  let state = baseRound(options.playerCount ?? 3);
  state = {
    ...state,
    activePlayerId: 'p0',
    board: options.board ?? createInitialBoard(),
    destinationIdentities: options.destinations ?? ['EMPTY', 'TREASURE', 'EMPTY'],
    drawPile: (options.drawPile ?? ['PATH_CROSS', 'SCOUT', 'PATH_CROSS']).map((typeId, i) => ({
      id: `d:${i}`,
      typeId,
    })),
    discardPile: [],
  };
  for (const player of state.players) {
    const role = player.seat === 1 ? 'DISRUPTOR' : 'MINER';
    const hand = options.hands?.[player.playerId] ?? ['DEAD_END_S', 'DEAD_END_E'];
    state = patchPlayer(withHand(state, player.playerId, hand), player.playerId, { role });
  }
  return state;
}
