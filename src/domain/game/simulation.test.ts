import { describe, expect, it } from 'vitest';
import { legalPlacements } from '../board/placement.ts';
import { isWithinBounds } from '../board/board.ts';
import { getCardDef } from '../cards/catalog.ts';
import { createSeededRng, nextInt, type Rng } from '../rng/rng.ts';
import { shuffle } from '../rng/shuffle.ts';
import { NOW } from '../testing/builders.ts';
import { isBlocked, isBroken } from '../tools/tools.ts';
import { applyCommand } from './applyCommand.ts';
import type { ActionTarget, GameCommand } from './commands.ts';
import { createRound } from './createRound.ts';
import { projectPublic } from './projections.ts';
import type { RoundState } from './types.ts';

/**
 * Seeded mini-simulation (TEST_STRATEGY §3, Tier B budget ≤ 10 s; this runs in well under 1 s).
 * Random *legal* play across every player count; any rejected command fails the test, which
 * also cross-checks that legalPlacements agrees with the authoritative validation.
 */
const pick = <T>(items: readonly T[], rng: Rng): T | undefined =>
  items.length ? items[nextInt(rng, items.length)] : undefined;

function actionTarget(state: RoundState, typeId: string, rng: Rng): ActionTarget | undefined {
  const def = getCardDef(typeId as Parameters<typeof getCardDef>[0]);
  const live = state.players.filter((p) => !p.hasLeft);
  switch (def.category) {
    case 'SABOTAGE': {
      const p = pick(
        live.filter((x) => !isBroken(x.tools, def.tool)),
        rng,
      );
      return p && { kind: 'PLAYER', playerId: p.playerId };
    }
    case 'REPAIR': {
      const options = live.flatMap((p) =>
        def.tools.filter((t) => isBroken(p.tools, t)).map((tool) => ({ p, tool })),
      );
      const o = pick(options, rng);
      return o && { kind: 'PLAYER', playerId: o.p.playerId, tool: o.tool };
    }
    case 'INSPECT': {
      const d = pick(
        state.board.destinations.filter((x) => x.revealed === null),
        rng,
      );
      return d && { kind: 'DESTINATION', slot: d.slot };
    }
    case 'BOARD': {
      const c = pick(Object.values(state.board.paths), rng);
      return c && { kind: 'CELL', x: c.x, y: c.y };
    }
    case 'PATH':
      return undefined;
  }
}

function chooseCommand(state: RoundState, rng: Rng): GameCommand {
  const me = state.players.find((p) => p.playerId === state.activePlayerId)!;
  for (const card of shuffle(me.hand.cards, rng)) {
    const def = getCardDef(card.typeId);
    if (def.category === 'PATH') {
      if (isBlocked(me.tools)) continue;
      for (const rotation of shuffle([0, 180] as const, rng)) {
        const cell = pick(legalPlacements(state.board, def.typeId, rotation), rng);
        if (cell) return { type: 'PLAY_PATH', cardId: card.id, x: cell.x, y: cell.y, rotation };
      }
    } else {
      const target = actionTarget(state, card.typeId, rng);
      if (target) return { type: 'PLAY_ACTION', cardId: card.id, target };
    }
  }
  return { type: 'DISCARD', cardId: pick(me.hand.cards, rng)!.id };
}

function cardIds(state: RoundState): string[] {
  return [
    ...state.players.flatMap((p) => p.hand.cards.map((c) => c.id)),
    ...state.drawPile.map((c) => c.id),
    ...state.discardPile.map((d) => d.card.id),
    ...Object.values(state.board.paths).map((p) => p.cardId),
  ];
}

describe('seeded mini-simulation', () => {
  it('80 random legal rounds across 3–10 players terminate with every invariant intact', () => {
    const outcomes = { MINER: 0, DISRUPTOR: 0, NONE: 0 };
    for (let n = 3; n <= 10; n++) {
      for (let i = 0; i < 10; i++) {
        const seed = `sim-${n}-${i}`;
        const rng = createSeededRng(`${seed}-policy`);
        const created = createRound({
          players: Array.from({ length: n }, (_, k) => ({ playerId: `p${k}`, seat: k })),
          roundNo: 1,
          seed,
          previousStartingSeat: null,
          now: NOW,
        });
        if (!created.ok) throw new Error(created.error.code);
        let state = created.value.state;
        let now = NOW;

        for (let step = 0; state.phase === 'ROUND_ACTIVE'; step++) {
          expect(step, seed).toBeLessThan(66);
          const timeout = nextInt(rng, 15) === 0;
          now = timeout ? (state.turnDeadline as number) : now + 1_000;
          const actor = timeout ? 'p0' : (state.activePlayerId as string);
          const command: GameCommand = timeout
            ? { type: 'RESOLVE_EXPIRED_TURN', expectedTurnNumber: state.turnNumber }
            : chooseCommand(state, rng);
          const result = applyCommand(state, actor, command, {
            now,
            expectedVersion: state.version,
          });
          if (!result.ok)
            throw new Error(
              `${seed} step ${step}: ${JSON.stringify(command)} → ${result.error.code}`,
            );

          const next = result.value.state;
          expect(
            Object.values(next.board.paths).every((c) => isWithinBounds(c)),
            seed,
          ).toBe(true);
          expect(next.version).toBe(state.version + 1);
          const ids = cardIds(next);
          expect(ids).toHaveLength(66);
          expect(new Set(ids).size).toBe(66);
          const publicJson = JSON.stringify(projectPublic(next));
          if (next.phase === 'ROUND_ACTIVE') expect(publicJson).not.toMatch(/MINER|DISRUPTOR/);
          state = next;
        }
        expect(state.result).not.toBeNull();
        outcomes[state.result!.winner]++;
      }
    }
    expect(outcomes.MINER + outcomes.DISRUPTOR).toBe(80);
  }, 20_000); // heavy by design (80 full rounds); avoid flaking under parallel load
});
