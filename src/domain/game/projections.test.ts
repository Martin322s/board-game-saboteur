import { describe, expect, it } from 'vitest';
import { baseRound } from '../testing/builders.ts';
import { applyCommand } from './applyCommand.ts';
import { projectPrivate, projectPublic, projectReveal } from './projections.ts';

describe('projections', () => {
  const state = baseRound(5, 'projection-seed');

  it('the public view carries no roles, hands, deck contents or hidden identities', () => {
    const json = JSON.stringify(projectPublic(state));
    const secretIds = [
      ...state.players.flatMap((p) => p.hand.cards.map((c) => c.id)),
      ...state.drawPile.map((c) => c.id),
    ];
    for (const secret of [
      ...secretIds,
      'MINER',
      'DISRUPTOR',
      'TREASURE',
      'EMPTY',
      '"role"',
      'setAside',
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(projectPublic(state).players.map((p) => p.handCount)).toEqual([6, 6, 6, 6, 6]);
    expect(projectPublic(state).drawPileCount).toBe(66 - 30);
  });

  it('the private view holds only the requesting player’s data', () => {
    const me = projectPrivate(state, 'p2');
    const other = state.players.find((p) => p.playerId === 'p3')!;
    expect(me?.playerId).toBe('p2');
    expect(me?.hand.map((c) => c.handPosition)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const card of other.hand.cards) expect(JSON.stringify(me)).not.toContain(card.id);
    expect(projectPrivate(state, 'nobody')).toBeNull();
  });

  it('roles and destinations are revealed only after the round ends', () => {
    expect(projectReveal(state)).toBeNull();
    let current = state;
    while (current.phase === 'ROUND_ACTIVE') {
      const out = applyCommand(current, current.activePlayerId!, { type: 'LEAVE' }, { now: 1 });
      if (!out.ok) throw new Error(out.error.code);
      current = out.value.state;
    }
    const reveal = projectReveal(current);
    expect(reveal?.roles).toHaveLength(5);
    expect(reveal?.setAsideRole).toBe(state.setAsideRole);
    expect(reveal?.destinations).toEqual(state.destinationIdentities);
  });
});
