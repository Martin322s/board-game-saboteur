import { createInitialBoard } from '../board/board.ts';
import type { CardInstance } from '../cards/types.ts';
import { handSizeFor, isSupportedPlayerCount } from '../config/players.ts';
import { buildShuffledDeck } from '../deck/deck.ts';
import { domainError, type DomainError } from '../errors.ts';
import { drawCardIntoHand, EMPTY_HAND, type HandState } from '../hands/hand.ts';
import type { DestinationIdentity, EpochMs, PlayerId, Seat } from '../primitives.ts';
import { err, ok, type Result } from '../result.ts';
import { dealRoles } from '../roles/roles.ts';
import { createSeededRng, nextInt } from '../rng/rng.ts';
import { shuffle } from '../rng/shuffle.ts';
import { ALL_TOOLS_INTACT } from '../tools/tools.ts';
import { seatAfter, turnTimeoutMs } from '../turns/turnOrder.ts';
import { RULES_VERSION } from '../version.ts';
import type { PublicEvent } from './events.ts';
import type { RoundPlayer, RoundState } from './types.ts';

export interface SeatedPlayer {
  readonly playerId: PlayerId;
  readonly seat: Seat;
}

export interface CreateRoundInput {
  /** Non-left players taking part in this round (any order; sorted by seat internally). */
  readonly players: readonly SeatedPlayer[];
  readonly roundNo: number;
  /** Server-generated secret seed. Never stored in client-visible state. */
  readonly seed: string;
  /** Previous round's starting seat; null for round 1. */
  readonly previousStartingSeat: Seat | null;
  readonly now: EpochMs;
}

export interface CreatedRound {
  readonly state: RoundState;
  readonly events: readonly PublicEvent[];
}

const DESTINATION_POOL: readonly DestinationIdentity[] = ['TREASURE', 'EMPTY', 'EMPTY'];

/**
 * Deterministic round setup (GAME_RULES §2.3). RNG consumption order is fixed:
 * roles → destinations → deck shuffle → card ids → starting player (round 1 only).
 */
export function createRound(input: CreateRoundInput): Result<CreatedRound, DomainError> {
  const players = [...input.players].sort((a, b) => a.seat - b.seat);
  const count = players.length;
  const uniqueIds = new Set(players.map((p) => p.playerId)).size === count;
  const uniqueSeats = new Set(players.map((p) => p.seat)).size === count;
  if (!isSupportedPlayerCount(count) || !uniqueIds || !uniqueSeats) {
    return err(domainError('INVALID_PLAYER_COUNT'));
  }

  const rng = createSeededRng(input.seed);
  const roles = dealRoles(count, rng);
  if (!roles.ok) return roles;
  const destinationIdentities = shuffle(DESTINATION_POOL, rng);
  let drawPile: readonly CardInstance[] = buildShuffledDeck(rng);

  // Round-robin deal, one card at a time, starting at list index 0.
  const hands: HandState[] = players.map(() => EMPTY_HAND);
  const handSize = handSizeFor(count);
  for (let round = 0; round < handSize; round++) {
    for (let i = 0; i < count; i++) {
      const dealt = drawCardIntoHand(drawPile, hands[i] as HandState);
      drawPile = dealt.pile;
      hands[i] = dealt.hand;
    }
  }

  const startingSeat =
    input.previousStartingSeat === null
      ? (players[nextInt(rng, count)] as SeatedPlayer).seat
      : seatAfter(
          players.map((p) => p.seat),
          input.previousStartingSeat,
        );
  const starter = players.find((p) => p.seat === startingSeat) as SeatedPlayer;

  const roundPlayers: RoundPlayer[] = players.map((p, i) => ({
    playerId: p.playerId,
    seat: p.seat,
    role: roles.value.dealt[i] as RoundPlayer['role'],
    hand: hands[i] as HandState,
    tools: ALL_TOOLS_INTACT,
    hasLeft: false,
    consecutiveTimeouts: 0,
    knownDestinations: [],
  }));

  const state: RoundState = {
    rulesVersion: RULES_VERSION,
    roundNo: input.roundNo,
    phase: 'ROUND_ACTIVE',
    version: 1,
    players: roundPlayers,
    setAsideRole: roles.value.setAside,
    destinationIdentities,
    board: createInitialBoard(),
    drawPile,
    discardPile: [],
    startingSeat,
    activePlayerId: starter.playerId,
    turnNumber: 1,
    turnStartedAt: input.now,
    turnDeadline: input.now + turnTimeoutMs(0),
    lastEventSeq: 1,
    result: null,
  };

  return ok({
    state,
    events: [{ seq: 1, type: 'ROUND_STARTED', roundNo: input.roundNo, startingSeat, handSize }],
  });
}
