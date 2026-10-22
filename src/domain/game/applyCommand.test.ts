import { describe, expect, it } from 'vitest';
import type { CardTypeId } from '../cards/types.ts';
import { boardWith, eastLine, NOW, patchPlayer, scenario } from '../testing/builders.ts';
import { ALL_TOOLS_INTACT } from '../tools/tools.ts';
import { applyCommand, type CommandResult } from './applyCommand.ts';
import type { CommandContext, GameCommand } from './commands.ts';
import type { RoundState } from './types.ts';

const T = NOW + 1_000;
const run = (
  state: RoundState,
  actor: string,
  command: GameCommand,
  ctx: CommandContext = { now: T },
) => applyCommand(state, actor, command, ctx);
const code = (r: CommandResult) => (r.ok ? 'OK' : r.error.code);
const okv = (r: CommandResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}`);
  return r.value;
};
const player = (s: RoundState, id: string) => s.players.find((p) => p.playerId === id)!;
const p0With = (...cards: CardTypeId[]) => scenario({ hands: { p0: cards } });

describe('command validation', () => {
  const s = p0With('PATH_STRAIGHT_EW', 'SCOUT');
  const ended: RoundState = {
    ...s,
    phase: 'ROUND_ENDED',
    activePlayerId: null,
    turnDeadline: null,
  };

  it.each<[string, RoundState, string, GameCommand, string]>([
    ['actor is not active', s, 'p1', { type: 'DISCARD', cardId: 'p1:0' }, 'NOT_YOUR_TURN'],
    [
      'card belongs to someone else',
      s,
      'p0',
      { type: 'DISCARD', cardId: 'p1:0' },
      'CARD_NOT_IN_HAND',
    ],
    ['forged card id', s, 'p0', { type: 'DISCARD', cardId: 'PATH_CROSS' }, 'CARD_NOT_IN_HAND'],
    ['unknown actor', s, 'zz', { type: 'DISCARD', cardId: 'p0:0' }, 'NOT_A_PLAYER'],
    ['round ended', ended, 'p0', { type: 'DISCARD', cardId: 'p0:0' }, 'ROUND_NOT_ACTIVE'],
    [
      'path command with an action card',
      s,
      'p0',
      { type: 'PLAY_PATH', cardId: 'p0:1', x: 1, y: 0, rotation: 0 },
      'WRONG_CARD_CATEGORY',
    ],
    [
      'action command with a path card',
      s,
      'p0',
      { type: 'PLAY_ACTION', cardId: 'p0:0', target: { kind: 'DESTINATION', slot: 0 } },
      'WRONG_CARD_CATEGORY',
    ],
    [
      'illegal placement',
      s,
      'p0',
      { type: 'PLAY_PATH', cardId: 'p0:0', x: 0, y: 1, rotation: 0 },
      'EDGE_MISMATCH',
    ],
    [
      'invalid rotation',
      s,
      'p0',
      { type: 'PLAY_PATH', cardId: 'p0:0', x: 1, y: 0, rotation: 90 },
      'INVALID_ROTATION',
    ],
    [
      'malformed payload',
      s,
      'p0',
      { type: 'PLAY_PATH', cardId: 'p0:0' } as unknown as GameCommand,
      'INVALID_COMMAND',
    ],
    [
      'unknown command',
      s,
      'p0',
      { type: 'FINISH_TURN' } as unknown as GameCommand,
      'INVALID_COMMAND',
    ],
  ])('rejects: %s', (_label, state, actor, command, expected) => {
    expect(code(run(state, actor, command))).toBe(expected);
  });

  it('rejects stale versions with the current version', () => {
    expect(
      run(s, 'p0', { type: 'DISCARD', cardId: 'p0:0' }, { now: T, expectedVersion: 7 }),
    ).toEqual({
      ok: false,
      error: { code: 'STALE_STATE', currentVersion: 1 },
    });
    expect(
      code(run(s, 'p0', { type: 'DISCARD', cardId: 'p0:0' }, { now: T, expectedVersion: 1 })),
    ).toBe('OK');
  });

  it('blocks path placement while any tool is broken, but not other actions', () => {
    const blocked = patchPlayer(s, 'p0', { tools: { ...ALL_TOOLS_INTACT, ROPE: 'BROKEN' } });
    expect(
      code(run(blocked, 'p0', { type: 'PLAY_PATH', cardId: 'p0:0', x: 1, y: 0, rotation: 0 })),
    ).toBe('PLAYER_BLOCKED');
    expect(
      code(
        run(blocked, 'p0', {
          type: 'PLAY_ACTION',
          cardId: 'p0:1',
          target: { kind: 'DESTINATION', slot: 0 },
        }),
      ),
    ).toBe('OK');
  });

  it('is deterministic and never mutates its input', () => {
    const before = JSON.stringify(s);
    const cmd: GameCommand = { type: 'PLAY_PATH', cardId: 'p0:0', x: 1, y: 0, rotation: 0 };
    expect(run(s, 'p0', cmd)).toEqual(run(s, 'p0', cmd));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('turn resolution', () => {
  it('places a path, draws at the next hand position and advances the turn', () => {
    const out = okv(
      run(p0With('PATH_STRAIGHT_EW', 'SCOUT'), 'p0', {
        type: 'PLAY_PATH',
        cardId: 'p0:0',
        x: 1,
        y: 0,
        rotation: 0,
      }),
    );
    expect(out.state.board.paths['1,0']).toMatchObject({
      typeId: 'PATH_STRAIGHT_EW',
      placedBy: 'p0',
      placedOnTurn: 1,
    });
    expect(player(out.state, 'p0').hand.cards.map((c) => [c.id, c.handPosition])).toEqual([
      ['p0:1', 1],
      ['d:0', 2],
    ]);
    expect(out.state).toMatchObject({
      activePlayerId: 'p1',
      turnNumber: 2,
      version: 2,
      turnStartedAt: T,
      turnDeadline: T + 60_000,
    });
    expect(out.state.drawPile).toHaveLength(2);
    expect(out.events).toEqual([
      {
        seq: 2,
        type: 'PATH_PLACED',
        actorId: 'p0',
        typeId: 'PATH_STRAIGHT_EW',
        x: 1,
        y: 0,
        rotation: 0,
      },
    ]);
    expect(out.privateEffects).toEqual([
      {
        kind: 'CARD_DRAWN',
        playerId: 'p0',
        card: { id: 'd:0', typeId: 'PATH_CROSS', handPosition: 2 },
      },
    ]);
    expect(out.roundScores).toBeNull();
  });

  it('discards face-down without revealing the card publicly', () => {
    const out = okv(run(p0With('BREAK_LAMP', 'SCOUT'), 'p0', { type: 'DISCARD', cardId: 'p0:0' }));
    expect(out.state.discardPile).toEqual([
      { card: { id: 'p0:0', typeId: 'BREAK_LAMP' }, faceUp: false },
    ]);
    expect(out.events).toEqual([{ seq: 2, type: 'CARD_DISCARDED', actorId: 'p0' }]);
  });

  it('a played card clears the AFK counter; an AFK next player gets the short timer', () => {
    let s = patchPlayer(p0With('SCOUT', 'SCOUT'), 'p0', { consecutiveTimeouts: 3 });
    s = patchPlayer(s, 'p1', { consecutiveTimeouts: 2 });
    const out = okv(run(s, 'p0', { type: 'DISCARD', cardId: 'p0:0' }));
    expect(player(out.state, 'p0').consecutiveTimeouts).toBe(0);
    expect(out.state.turnDeadline).toBe(T + 15_000);
  });
});

describe('action cards', () => {
  const act = (
    state: RoundState,
    cardId: string,
    target: Extract<GameCommand, { type: 'PLAY_ACTION' }>['target'],
  ) => run(state, 'p0', { type: 'PLAY_ACTION', cardId, target });

  it('break: marks the tool broken; repeated break, left or wrong-kind targets are rejected', () => {
    const s = p0With('BREAK_DRILL');
    const out = okv(act(s, 'p0:0', { kind: 'PLAYER', playerId: 'p1' }));
    expect(player(out.state, 'p1').tools.DRILL).toBe('BROKEN');
    expect(out.state.discardPile).toEqual([
      { card: { id: 'p0:0', typeId: 'BREAK_DRILL' }, faceUp: true },
    ]);
    expect(out.events[0]).toMatchObject({ type: 'TOOL_BROKEN', targetId: 'p1', tool: 'DRILL' });

    const drillBroken = patchPlayer(s, 'p1', { tools: { ...ALL_TOOLS_INTACT, DRILL: 'BROKEN' } });
    expect(code(act(drillBroken, 'p0:0', { kind: 'PLAYER', playerId: 'p1' }))).toBe(
      'TOOL_ALREADY_BROKEN',
    );
    expect(code(act(s, 'p0:0', { kind: 'PLAYER', playerId: 'p0' }))).toBe('OK'); // self allowed
    expect(
      code(
        act(patchPlayer(s, 'p2', { hasLeft: true }), 'p0:0', { kind: 'PLAYER', playerId: 'p2' }),
      ),
    ).toBe('INVALID_TARGET');
    expect(code(act(s, 'p0:0', { kind: 'DESTINATION', slot: 0 }))).toBe('INVALID_TARGET');
  });

  it('repair: single and dual-tool cards follow their tool restrictions', () => {
    const broken = (s: RoundState, ...tools: ('DRILL' | 'LAMP' | 'ROPE')[]) =>
      patchPlayer(s, 'p1', {
        tools: { ...ALL_TOOLS_INTACT, ...Object.fromEntries(tools.map((t) => [t, 'BROKEN'])) },
      });

    const single = broken(p0With('REPAIR_LAMP'), 'LAMP');
    expect(
      player(okv(act(single, 'p0:0', { kind: 'PLAYER', playerId: 'p1' })).state, 'p1').tools.LAMP,
    ).toBe('INTACT');
    expect(code(act(single, 'p0:0', { kind: 'PLAYER', playerId: 'p2' }))).toBe('TOOL_NOT_BROKEN');
    expect(code(act(single, 'p0:0', { kind: 'PLAYER', playerId: 'p1', tool: 'ROPE' }))).toBe(
      'INVALID_TOOL',
    );

    const dual = broken(p0With('REPAIR_DRILL_ROPE'), 'ROPE', 'LAMP');
    expect(code(act(dual, 'p0:0', { kind: 'PLAYER', playerId: 'p1' }))).toBe('INVALID_TOOL');
    expect(code(act(dual, 'p0:0', { kind: 'PLAYER', playerId: 'p1', tool: 'LAMP' }))).toBe(
      'INVALID_TOOL',
    );
    expect(code(act(dual, 'p0:0', { kind: 'PLAYER', playerId: 'p1', tool: 'DRILL' }))).toBe(
      'TOOL_NOT_BROKEN',
    );
    const out = okv(act(dual, 'p0:0', { kind: 'PLAYER', playerId: 'p1', tool: 'ROPE' }));
    expect(player(out.state, 'p1').tools).toEqual({
      DRILL: 'INTACT',
      LAMP: 'BROKEN',
      ROPE: 'INTACT',
    });
  });

  it('scout: identity goes only to the actor; public event carries the slot only', () => {
    const s = p0With('SCOUT');
    const out = okv(act(s, 'p0:0', { kind: 'DESTINATION', slot: 1 }));
    expect(out.privateEffects[0]).toEqual({
      kind: 'SCOUT_RESULT',
      playerId: 'p0',
      slot: 1,
      identity: 'TREASURE',
    });
    expect(out.events[0]).toEqual({ seq: 2, type: 'DESTINATION_SCOUTED', actorId: 'p0', slot: 1 });
    expect(JSON.stringify(out.events)).not.toContain('TREASURE');
    expect(player(out.state, 'p0').knownDestinations).toEqual([{ slot: 1, identity: 'TREASURE' }]);
    expect(out.state.board.destinations[1]?.revealed).toBeNull();

    const revealed = { ...s, board: boardWith([], { 0: 'EMPTY' }) };
    expect(code(act(revealed, 'p0:0', { kind: 'DESTINATION', slot: 0 }))).toBe(
      'DESTINATION_ALREADY_REVEALED',
    );
    expect(code(act(s, 'p0:0', { kind: 'DESTINATION', slot: 3 }))).toBe('INVALID_TARGET');
  });

  it('collapse: removes a path card only', () => {
    const s = { ...p0With('COLLAPSE'), board: boardWith(eastLine(2)) };
    const out = okv(act(s, 'p0:0', { kind: 'CELL', x: 2, y: 0 }));
    expect(out.state.board.paths['2,0']).toBeUndefined();
    expect(out.state.discardPile.map((d) => [d.card.typeId, d.faceUp])).toEqual([
      ['COLLAPSE', true],
      ['PATH_STRAIGHT_EW', true],
    ]);
    expect(out.events[0]).toMatchObject({
      type: 'PATH_COLLAPSED',
      x: 2,
      y: 0,
      removedTypeId: 'PATH_STRAIGHT_EW',
    });
    for (const [x, y] of [
      [0, 0],
      [8, 0],
      [5, 5],
    ]) {
      expect(code(act(s, 'p0:0', { kind: 'CELL', x: x!, y: y! }))).toBe('INVALID_COLLAPSE_TARGET');
    }
  });
});

describe('RESOLVE_EXPIRED_TURN', () => {
  const deadline = NOW + 60_000;
  // p0's hand in arbitrary array order with gaps: lowest position is "y" (2).
  const s = patchPlayer(scenario(), 'p0', {
    hand: {
      cards: [
        { id: 'x', typeId: 'SCOUT', handPosition: 5 },
        { id: 'y', typeId: 'COLLAPSE', handPosition: 2 },
        { id: 'z', typeId: 'PATH_CROSS', handPosition: 7 },
      ],
      nextHandPosition: 8,
    },
  });
  const resolve = (
    state: RoundState,
    actor: string,
    now: number,
    expectedTurnNumber = 1,
    expectedVersion?: number,
  ) =>
    applyCommand(
      state,
      actor,
      { type: 'RESOLVE_EXPIRED_TURN', expectedTurnNumber },
      expectedVersion === undefined ? { now } : { now, expectedVersion },
    );

  it('is rejected before the server deadline, reporting the remaining time', () => {
    expect(resolve(s, 'p1', deadline - 1_000)).toEqual({
      ok: false,
      error: { code: 'TURN_NOT_EXPIRED', remainingMs: 1_000 },
    });
    // Deadline is checked before the version.
    expect(code(resolve(s, 'p1', deadline - 1, 1, 99))).toBe('TURN_NOT_EXPIRED');
    expect(code(resolve(s, 'p1', deadline, 1, 99))).toBe('STALE_STATE');
  });

  it('after the deadline discards the lowest hand position, draws and advances atomically', () => {
    const out = okv(resolve(s, 'p2', deadline));
    expect(out.state.discardPile).toEqual([
      { card: { id: 'y', typeId: 'COLLAPSE' }, faceUp: false },
    ]);
    expect(player(out.state, 'p0').hand.cards.map((c) => [c.id, c.handPosition])).toEqual([
      ['x', 5],
      ['z', 7],
      ['d:0', 8],
    ]);
    expect(player(out.state, 'p0').consecutiveTimeouts).toBe(1);
    expect(out.state).toMatchObject({
      activePlayerId: 'p1',
      turnNumber: 2,
      version: 2,
      turnDeadline: deadline + 60_000,
    });
    expect(out.events).toEqual([{ seq: 2, type: 'TURN_TIMED_OUT', playerId: 'p0' }]);
  });

  it('only one resolution per turn: replays and racing requests get TURN_ALREADY_RESOLVED', () => {
    const first = okv(resolve(s, 'p2', deadline));
    expect(code(resolve(first.state, 'p1', deadline + 5))).toBe('TURN_ALREADY_RESOLVED');
    expect(code(resolve(s, 'p1', deadline, 4))).toBe('TURN_ALREADY_RESOLVED');
    const ended: RoundState = {
      ...s,
      phase: 'ROUND_ENDED',
      activePlayerId: null,
      turnDeadline: null,
    };
    expect(code(resolve(ended, 'p1', deadline))).toBe('TURN_ALREADY_RESOLVED');
  });

  it('flags the player AFK after repeated timeouts', () => {
    const afk = okv(resolve(patchPlayer(s, 'p0', { consecutiveTimeouts: 1 }), 'p1', deadline));
    expect(player(afk.state, 'p0').consecutiveTimeouts).toBe(2);
  });
});

describe('round end', () => {
  it('miners win when a placement reveals the treasure; no draw; scores attached', () => {
    const s = { ...p0With('PATH_STRAIGHT_EW', 'SCOUT'), board: boardWith(eastLine(6)) };
    const out = okv(run(s, 'p0', { type: 'PLAY_PATH', cardId: 'p0:0', x: 7, y: 0, rotation: 0 }));
    expect(out.state).toMatchObject({
      phase: 'ROUND_ENDED',
      activePlayerId: null,
      turnDeadline: null,
      version: 2,
    });
    expect(out.state.result).toEqual({
      winner: 'MINER',
      endReason: 'TREASURE_REACHED',
      connectorId: 'p0',
      endedAt: T,
      resultsDeadline: T + 45_000,
    });
    expect(out.state.drawPile).toHaveLength(3);
    expect(out.privateEffects).toEqual([]);
    expect(out.events.map((e) => e.type)).toEqual([
      'PATH_PLACED',
      'DESTINATION_REVEALED',
      'ROUND_ENDED',
    ]);
    expect(out.roundScores?.map((e) => e.points)).toEqual([3, 0, 2]);
  });

  it('a tunnel closed toward the treasure is legal but neither reveals it nor wins', () => {
    const s = { ...p0With('PATH_CORNER_SW', 'SCOUT'), board: boardWith(eastLine(6)) };
    const out = okv(run(s, 'p0', { type: 'PLAY_PATH', cardId: 'p0:0', x: 7, y: 0, rotation: 0 }));
    expect(out.state.phase).toBe('ROUND_ACTIVE');
    expect(out.state.board.destinations.every((d) => d.revealed === null)).toBe(true);
    expect(out.events.map((e) => e.type)).toEqual(['PATH_PLACED']);
  });

  it('reaching an empty destination reveals it and play continues', () => {
    const s = {
      ...scenario({
        hands: { p0: ['PATH_STRAIGHT_EW'] },
        destinations: ['TREASURE', 'EMPTY', 'EMPTY'],
      }),
      board: boardWith(eastLine(6)),
    };
    const out = okv(run(s, 'p0', { type: 'PLAY_PATH', cardId: 'p0:0', x: 7, y: 0, rotation: 0 }));
    expect(out.state.phase).toBe('ROUND_ACTIVE');
    expect(out.state.board.destinations.map((d) => d.revealed)).toEqual([null, 'EMPTY', null]);
  });

  it('disruptors win by exhaustion: empty draw pile and every remaining hand empty', () => {
    const s = scenario({ hands: { p0: ['SCOUT'], p1: [], p2: [] }, drawPile: [] });
    const out = okv(run(s, 'p0', { type: 'DISCARD', cardId: 'p0:0' }));
    expect(out.state.result).toMatchObject({
      winner: 'DISRUPTOR',
      endReason: 'EXHAUSTED',
      connectorId: null,
    });
    expect(out.roundScores?.map((e) => e.points)).toEqual([0, 4, 0]);
  });

  it('neither condition: play continues and empty hands are skipped', () => {
    const s = scenario({ hands: { p0: ['SCOUT', 'SCOUT'], p1: [], p2: ['SCOUT'] }, drawPile: [] });
    const out = okv(run(s, 'p0', { type: 'DISCARD', cardId: 'p0:0' }));
    expect(out.state).toMatchObject({ phase: 'ROUND_ACTIVE', activePlayerId: 'p2' });
  });
});

describe('LEAVE', () => {
  it('the active player leaving discards their hand and passes the turn without drawing', () => {
    const out = okv(run(scenario(), 'p0', { type: 'LEAVE' }));
    expect(player(out.state, 'p0')).toMatchObject({ hasLeft: true, hand: { cards: [] } });
    expect(out.state.discardPile.every((d) => !d.faceUp)).toBe(true);
    expect(out.state.discardPile).toHaveLength(2);
    expect(out.state).toMatchObject({ activePlayerId: 'p1', turnNumber: 2 });
    expect(out.privateEffects).toEqual([]);
    expect(code(run(out.state, 'p0', { type: 'DISCARD', cardId: 'p0:1' }))).toBe('PLAYER_LEFT');
  });

  it('a non-active player leaving keeps the turn; fewer than 2 players ends the round', () => {
    const once = okv(run(scenario(), 'p2', { type: 'LEAVE' }));
    expect(once.state).toMatchObject({
      activePlayerId: 'p0',
      turnNumber: 1,
      phase: 'ROUND_ACTIVE',
    });
    const twice = okv(run(once.state, 'p1', { type: 'LEAVE' }));
    expect(twice.state.result).toMatchObject({ winner: 'NONE', endReason: 'INSUFFICIENT_PLAYERS' });
    expect(twice.roundScores?.every((e) => e.points === 0)).toBe(true);
  });
});
