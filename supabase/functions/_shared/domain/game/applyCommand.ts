import { cellAt, placePath, removePath, revealDestination } from '../board/board.ts';
import type { Rotation } from '../board/direction.ts';
import { checkPathPlacement } from '../board/placement.ts';
import { computeReachability } from '../board/reachability.ts';
import { getCardDef, isPathDef } from '../cards/catalog.ts';
import type { ActionCardDef, CardInstance } from '../cards/types.ts';
import { domainError, type DomainError, type DomainErrorCode } from '../errors.ts';
import {
  drawCardIntoHand,
  findCardInHand,
  removeCardFromHand,
  selectTimeoutDiscard,
  type HandCard,
} from '../hands/hand.ts';
import {
  isDestinationSlot,
  type CardId,
  type DestinationIdentity,
  type EpochMs,
  type PlayerId,
} from '../primitives.ts';
import { err, ok, type Result } from '../result.ts';
import type { RoundOutcome, ScoreEntry } from '../scoring/scoring.ts';
import { breakTool, isBlocked, repairTool } from '../tools/tools.ts';
import { nextEligiblePlayer, turnTimeoutMs } from '../turns/turnOrder.ts';
import type { ActionTarget, CommandContext, GameCommand } from './commands.ts';
import type { PrivateEffect, PublicEvent, PublicEventBody } from './events.ts';
import {
  activePlayerCount,
  endRound,
  isExhausted,
  revealsTreasure,
  scoreEndedRound,
} from './roundEnd.ts';
import type { RoundPlayer, RoundState } from './types.ts';

export interface CommandOutcome {
  readonly state: RoundState;
  /** Public events with assigned sequence numbers. */
  readonly events: readonly PublicEvent[];
  /** Effects visible only to the named player. */
  readonly privateEffects: readonly PrivateEffect[];
  /** Score entries when this command ended the round, otherwise null. */
  readonly roundScores: readonly ScoreEntry[] | null;
}

export type CommandResult = Result<CommandOutcome, DomainError>;

/** Working set for one atomic transition. Local to a single applyCommand call. */
interface Transition {
  state: RoundState;
  readonly events: PublicEventBody[];
  readonly privateEffects: PrivateEffect[];
}

const fail = (code: DomainErrorCode, extra: Omit<DomainError, 'code'> = {}): CommandResult =>
  err(domainError(code, extra));

/**
 * The single authoritative command boundary (ARCHITECTURE §3.2).
 *
 * Pure and deterministic: the same (state, actor, command, ctx) always yields the same result.
 * No randomness is needed after round setup, so none is accepted here.
 * `actorId` must come from the authenticated session, never from the command payload.
 */
export function applyCommand(
  state: RoundState,
  actorId: PlayerId,
  command: GameCommand,
  ctx: CommandContext,
): CommandResult {
  if (!isWellFormedCommand(command)) return fail('INVALID_COMMAND');
  switch (command.type) {
    case 'PLAY_PATH':
      return playPath(state, actorId, command, ctx);
    case 'PLAY_ACTION':
      return playAction(state, actorId, command, ctx);
    case 'DISCARD':
      return discard(state, actorId, command.cardId, ctx);
    case 'RESOLVE_EXPIRED_TURN':
      return resolveExpiredTurn(state, actorId, command.expectedTurnNumber, ctx);
    case 'LEAVE':
      return leave(state, actorId, ctx);
  }
}

// ---------------------------------------------------------------------------------------------
// Card plays

interface CardPlayContext {
  readonly actor: RoundPlayer;
  readonly card: HandCard;
}

/** GAME_RULES §7.1 steps 1–3 (plus version and membership checks). */
function precheckCardPlay(
  state: RoundState,
  actorId: PlayerId,
  cardId: CardId,
  ctx: CommandContext,
): Result<CardPlayContext, DomainError> {
  if (state.phase !== 'ROUND_ACTIVE') return err(domainError('ROUND_NOT_ACTIVE'));
  const actor = findPlayer(state, actorId);
  if (!actor) return err(domainError('NOT_A_PLAYER'));
  if (actor.hasLeft) return err(domainError('PLAYER_LEFT'));
  const stale = checkVersion(state, ctx);
  if (stale) return err(stale);
  if (state.activePlayerId !== actorId) return err(domainError('NOT_YOUR_TURN'));
  const card = findCardInHand(actor.hand, cardId);
  if (!card) return err(domainError('CARD_NOT_IN_HAND'));
  return ok({ actor, card });
}

function playPath(
  state: RoundState,
  actorId: PlayerId,
  command: Extract<GameCommand, { type: 'PLAY_PATH' }>,
  ctx: CommandContext,
): CommandResult {
  const pre = precheckCardPlay(state, actorId, command.cardId, ctx);
  if (!pre.ok) return pre;
  const def = getCardDef(pre.value.card.typeId);
  if (!isPathDef(def)) return fail('WRONG_CARD_CATEGORY');
  if (isBlocked(pre.value.actor.tools)) return fail('PLAYER_BLOCKED');

  const coord = { x: command.x, y: command.y };
  const placement = checkPathPlacement(state.board, def.typeId, coord, command.rotation);
  if (!placement.legal) return fail(placement.reason);
  const rotation = command.rotation as Rotation;

  const t = begin(takeCardFromActor(state, actorId, command.cardId).state);
  let board = placePath(t.state.board, {
    cardId: command.cardId,
    typeId: def.typeId,
    rotation,
    x: coord.x,
    y: coord.y,
    placedBy: actorId,
    placedOnTurn: state.turnNumber,
  });
  t.events.push({
    type: 'PATH_PLACED',
    actorId,
    typeId: def.typeId,
    x: coord.x,
    y: coord.y,
    rotation,
  });

  // GAME_RULES §7.3: reveal every hidden destination now faced by a reached opening.
  const revealed: DestinationIdentity[] = [];
  for (const slot of computeReachability(board).touchedHiddenDestinations) {
    const identity = state.destinationIdentities[slot] as DestinationIdentity;
    board = revealDestination(board, slot, identity);
    revealed.push(identity);
    t.events.push({ type: 'DESTINATION_REVEALED', slot, identity });
  }
  t.state = { ...t.state, board };

  if (revealsTreasure(revealed)) {
    finishRound(
      t,
      { winner: 'MINER', endReason: 'TREASURE_REACHED', connectorId: actorId },
      ctx.now,
    );
  } else {
    finishTurn(t, actorId, ctx.now, { draw: true });
  }
  return commit(state, t);
}

function playAction(
  state: RoundState,
  actorId: PlayerId,
  command: Extract<GameCommand, { type: 'PLAY_ACTION' }>,
  ctx: CommandContext,
): CommandResult {
  const pre = precheckCardPlay(state, actorId, command.cardId, ctx);
  if (!pre.ok) return pre;
  const def = getCardDef(pre.value.card.typeId);
  if (isPathDef(def)) return fail('WRONG_CARD_CATEGORY');

  const effect = resolveActionEffect(state, actorId, def, command.target);
  if (!effect.ok) return effect;

  const taken = takeCardFromActor(state, actorId, command.cardId);
  const t = begin(taken.state);
  t.state = withDiscard(t.state, taken.card, true);
  effect.value(t);
  finishTurn(t, actorId, ctx.now, { draw: true });
  return commit(state, t);
}

/**
 * Validate an action against the pre-play state and return the mutation to apply
 * (GAME_RULES §8.2). Validation never mutates; mutation never fails.
 */
function resolveActionEffect(
  state: RoundState,
  actorId: PlayerId,
  def: ActionCardDef,
  target: ActionTarget,
): Result<(t: Transition) => void, DomainError> {
  switch (def.category) {
    case 'SABOTAGE': {
      const targetPlayer = playerTarget(state, target);
      if (!targetPlayer) return err(domainError('INVALID_TARGET'));
      const tools = breakTool(targetPlayer.tools, def.tool);
      if (!tools.ok) return tools;
      return ok((t) => {
        t.state = updatePlayer(t.state, targetPlayer.playerId, (p) => ({
          ...p,
          tools: tools.value,
        }));
        t.events.push({
          type: 'TOOL_BROKEN',
          actorId,
          targetId: targetPlayer.playerId,
          tool: def.tool,
          typeId: def.typeId,
        });
      });
    }
    case 'REPAIR': {
      const targetPlayer = playerTarget(state, target);
      if (!targetPlayer || target.kind !== 'PLAYER') return err(domainError('INVALID_TARGET'));
      const single = def.tools.length === 1 ? def.tools[0] : undefined;
      const tool = single ?? target.tool;
      if (
        !tool ||
        !def.tools.includes(tool) ||
        (target.tool !== undefined && target.tool !== tool)
      ) {
        return err(domainError('INVALID_TOOL'));
      }
      const tools = repairTool(targetPlayer.tools, tool);
      if (!tools.ok) return tools;
      return ok((t) => {
        t.state = updatePlayer(t.state, targetPlayer.playerId, (p) => ({
          ...p,
          tools: tools.value,
        }));
        t.events.push({
          type: 'TOOL_REPAIRED',
          actorId,
          targetId: targetPlayer.playerId,
          tool,
          typeId: def.typeId,
        });
      });
    }
    case 'INSPECT': {
      if (target.kind !== 'DESTINATION' || !isDestinationSlot(target.slot)) {
        return err(domainError('INVALID_TARGET'));
      }
      const slot = target.slot;
      const destination = state.board.destinations.find((d) => d.slot === slot);
      if (!destination) return err(domainError('INVALID_TARGET'));
      if (destination.revealed !== null) return err(domainError('DESTINATION_ALREADY_REVEALED'));
      const identity = state.destinationIdentities[slot] as DestinationIdentity;
      return ok((t) => {
        t.state = updatePlayer(t.state, actorId, (p) => ({
          ...p,
          knownDestinations: [
            ...p.knownDestinations.filter((k) => k.slot !== slot),
            { slot, identity },
          ].sort((a, b) => a.slot - b.slot),
        }));
        t.privateEffects.push({ kind: 'SCOUT_RESULT', playerId: actorId, slot, identity });
        t.events.push({ type: 'DESTINATION_SCOUTED', actorId, slot });
      });
    }
    case 'BOARD': {
      if (target.kind !== 'CELL') return err(domainError('INVALID_TARGET'));
      const coord = { x: target.x, y: target.y };
      const cell = cellAt(state.board, coord);
      if (cell.kind !== 'PATH') return err(domainError('INVALID_COLLAPSE_TARGET'));
      const removed: CardInstance = { id: cell.path.cardId, typeId: cell.path.typeId };
      return ok((t) => {
        t.state = withDiscard(
          { ...t.state, board: removePath(t.state.board, coord) },
          removed,
          true,
        );
        t.events.push({
          type: 'PATH_COLLAPSED',
          actorId,
          x: coord.x,
          y: coord.y,
          removedTypeId: cell.path.typeId,
        });
      });
    }
  }
}

function playerTarget(state: RoundState, target: ActionTarget): RoundPlayer | null {
  if (target.kind !== 'PLAYER') return null;
  const player = findPlayer(state, target.playerId);
  return player && !player.hasLeft ? player : null;
}

function discard(
  state: RoundState,
  actorId: PlayerId,
  cardId: CardId,
  ctx: CommandContext,
): CommandResult {
  const pre = precheckCardPlay(state, actorId, cardId, ctx);
  if (!pre.ok) return pre;
  const taken = takeCardFromActor(state, actorId, cardId);
  const t = begin(withDiscard(taken.state, taken.card, false));
  t.events.push({ type: 'CARD_DISCARDED', actorId });
  finishTurn(t, actorId, ctx.now, { draw: true });
  return commit(state, t);
}

// ---------------------------------------------------------------------------------------------
// Expired turns and leaving

/** GAME_RULES §8.5 / ARCHITECTURE §8.1. Any non-left player of the round may request it. */
function resolveExpiredTurn(
  state: RoundState,
  actorId: PlayerId,
  expectedTurnNumber: number,
  ctx: CommandContext,
): CommandResult {
  if (state.phase !== 'ROUND_ACTIVE') return fail('TURN_ALREADY_RESOLVED');
  const actor = findPlayer(state, actorId);
  if (!actor) return fail('NOT_A_PLAYER');
  if (actor.hasLeft) return fail('PLAYER_LEFT');
  if (state.turnNumber !== expectedTurnNumber) return fail('TURN_ALREADY_RESOLVED');
  const deadline = state.turnDeadline as EpochMs;
  if (ctx.now < deadline) return fail('TURN_NOT_EXPIRED', { remainingMs: deadline - ctx.now });
  const stale = checkVersion(state, ctx);
  if (stale) return err(stale);

  const timedOut = findPlayer(state, state.activePlayerId ?? '');
  if (!timedOut) throw new Error('Invariant violated: active round without an active player');
  const card = selectTimeoutDiscard(timedOut.hand.cards);
  if (!card) throw new Error('Invariant violated: active player has no cards');

  const taken = takeCardFromActor(state, timedOut.playerId, card.id, { resetTimeouts: false });
  let next = updatePlayer(withDiscard(taken.state, taken.card, false), timedOut.playerId, (p) => ({
    ...p,
    consecutiveTimeouts: p.consecutiveTimeouts + 1,
  }));
  if (actorId !== timedOut.playerId) {
    next = updatePlayer(next, actorId, (p) => ({ ...p, consecutiveTimeouts: 0 }));
  }
  const t = begin(next);
  t.events.push({ type: 'TURN_TIMED_OUT', playerId: timedOut.playerId });
  finishTurn(t, timedOut.playerId, ctx.now, { draw: true });
  return commit(state, t);
}

/** GAME_RULES §12. Allowed for any non-left player, during or after a round. */
function leave(state: RoundState, actorId: PlayerId, ctx: CommandContext): CommandResult {
  const actor = findPlayer(state, actorId);
  if (!actor) return fail('NOT_A_PLAYER');
  if (actor.hasLeft) return fail('PLAYER_LEFT');
  const stale = checkVersion(state, ctx);
  if (stale) return err(stale);

  if (state.phase === 'ROUND_ENDED') {
    const t = begin(updatePlayer(state, actorId, (p) => ({ ...p, hasLeft: true })));
    t.events.push({ type: 'PLAYER_LEFT', playerId: actorId });
    return commit(state, t);
  }

  let next = updatePlayer(state, actorId, (p) => ({
    ...p,
    hasLeft: true,
    hand: { ...p.hand, cards: [] },
  }));
  for (const card of actor.hand.cards) next = withDiscard(next, card, false);
  const t = begin(next);
  t.events.push({ type: 'PLAYER_LEFT', playerId: actorId });

  if (activePlayerCount(t.state) < 2) {
    finishRound(
      t,
      { winner: 'NONE', endReason: 'INSUFFICIENT_PLAYERS', connectorId: null },
      ctx.now,
    );
  } else if (state.activePlayerId === actorId) {
    finishTurn(t, actorId, ctx.now, { draw: false });
  } else if (isExhausted(t.state)) {
    finishRound(t, { winner: 'DISRUPTOR', endReason: 'EXHAUSTED', connectorId: null }, ctx.now);
  }
  return commit(state, t);
}

// ---------------------------------------------------------------------------------------------
// Turn resolution (GAME_RULES §8.3 steps 5–9)

function begin(state: RoundState): Transition {
  return { state, events: [], privateEffects: [] };
}

function finishRound(t: Transition, outcome: RoundOutcome, now: EpochMs): void {
  t.state = endRound(t.state, outcome, now);
  t.events.push({
    type: 'ROUND_ENDED',
    winner: outcome.winner,
    endReason: outcome.endReason,
    connectorId: outcome.connectorId,
    endedAt: now,
  });
}

/** Steps 6–8: draw (if requested), exhaustion check, advance to the next eligible player. */
function finishTurn(
  t: Transition,
  turnOwnerId: PlayerId,
  now: EpochMs,
  options: { readonly draw: boolean },
): void {
  if (options.draw) {
    const owner = findPlayer(t.state, turnOwnerId) as RoundPlayer;
    const drawn = drawCardIntoHand(t.state.drawPile, owner.hand);
    if (drawn.drawn) {
      t.state = {
        ...updatePlayer(t.state, turnOwnerId, (p) => ({ ...p, hand: drawn.hand })),
        drawPile: drawn.pile,
      };
      t.privateEffects.push({ kind: 'CARD_DRAWN', playerId: turnOwnerId, card: drawn.drawn });
    }
  }

  if (isExhausted(t.state)) {
    finishRound(t, { winner: 'DISRUPTOR', endReason: 'EXHAUSTED', connectorId: null }, now);
    return;
  }

  const current = findPlayer(t.state, turnOwnerId) as RoundPlayer;
  const nextId = nextEligiblePlayer(
    t.state.players.map((p) => ({ ...p, handCount: p.hand.cards.length })),
    current.seat,
  );
  const nextPlayer = nextId === null ? undefined : findPlayer(t.state, nextId);
  if (!nextPlayer)
    throw new Error('Invariant violated: no eligible player in a non-exhausted round');

  t.state = {
    ...t.state,
    activePlayerId: nextPlayer.playerId,
    turnNumber: t.state.turnNumber + 1,
    turnStartedAt: now,
    turnDeadline: now + turnTimeoutMs(nextPlayer.consecutiveTimeouts),
  };
}

/** Step 9 plus event sequencing and scoring. */
function commit(before: RoundState, t: Transition): CommandResult {
  const events: PublicEvent[] = t.events.map((body, i) => ({
    ...body,
    seq: before.lastEventSeq + i + 1,
  }));
  const state: RoundState = {
    ...t.state,
    version: before.version + 1,
    lastEventSeq: before.lastEventSeq + events.length,
  };
  const ended = before.phase === 'ROUND_ACTIVE' && state.phase === 'ROUND_ENDED';
  return ok({
    state,
    events,
    privateEffects: t.privateEffects,
    roundScores: ended ? scoreEndedRound(state) : null,
  });
}

// ---------------------------------------------------------------------------------------------
// Helpers

function findPlayer(state: RoundState, playerId: PlayerId): RoundPlayer | undefined {
  return state.players.find((p) => p.playerId === playerId);
}

function updatePlayer(
  state: RoundState,
  playerId: PlayerId,
  update: (player: RoundPlayer) => RoundPlayer,
): RoundState {
  return {
    ...state,
    players: state.players.map((p) => (p.playerId === playerId ? update(p) : p)),
  };
}

function checkVersion(state: RoundState, ctx: CommandContext): DomainError | null {
  return ctx.expectedVersion !== undefined && ctx.expectedVersion !== state.version
    ? domainError('STALE_STATE', { currentVersion: state.version })
    : null;
}

/** Remove a card known to be in the player's hand; by default a played card clears AFK. */
function takeCardFromActor(
  state: RoundState,
  playerId: PlayerId,
  cardId: CardId,
  options: { readonly resetTimeouts: boolean } = { resetTimeouts: true },
): { readonly state: RoundState; readonly card: HandCard } {
  const player = findPlayer(state, playerId) as RoundPlayer;
  const removed = removeCardFromHand(player.hand, cardId);
  if (!removed) throw new Error('Invariant violated: card was validated as in hand');
  return {
    state: updatePlayer(state, playerId, (p) => ({
      ...p,
      hand: removed.hand,
      consecutiveTimeouts: options.resetTimeouts ? 0 : p.consecutiveTimeouts,
    })),
    card: removed.card,
  };
}

function withDiscard(state: RoundState, card: CardInstance, faceUp: boolean): RoundState {
  return {
    ...state,
    discardPile: [...state.discardPile, { card: { id: card.id, typeId: card.typeId }, faceUp }],
  };
}

const COMMAND_TYPES: ReadonlySet<string> = new Set([
  'PLAY_PATH',
  'PLAY_ACTION',
  'DISCARD',
  'RESOLVE_EXPIRED_TURN',
  'LEAVE',
]);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Defensive shape check: commands originate from untrusted JSON. */
function isWellFormedCommand(command: unknown): command is GameCommand {
  if (typeof command !== 'object' || command === null) return false;
  const c = command as Record<string, unknown>;
  if (typeof c.type !== 'string' || !COMMAND_TYPES.has(c.type)) return false;
  switch (c.type) {
    case 'PLAY_PATH':
      return (
        isNonEmptyString(c.cardId) &&
        isFiniteNumber(c.x) &&
        isFiniteNumber(c.y) &&
        isFiniteNumber(c.rotation)
      );
    case 'PLAY_ACTION':
      return isNonEmptyString(c.cardId) && isWellFormedTarget(c.target);
    case 'DISCARD':
      return isNonEmptyString(c.cardId);
    case 'RESOLVE_EXPIRED_TURN':
      return Number.isInteger(c.expectedTurnNumber);
    default:
      return true;
  }
}

function isWellFormedTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const t = target as Record<string, unknown>;
  switch (t.kind) {
    case 'PLAYER':
      return isNonEmptyString(t.playerId) && (t.tool === undefined || typeof t.tool === 'string');
    case 'DESTINATION':
      return isFiniteNumber(t.slot);
    case 'CELL':
      return isFiniteNumber(t.x) && isFiniteNumber(t.y);
    default:
      return false;
  }
}
