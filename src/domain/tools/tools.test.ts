import { describe, expect, it } from 'vitest';
import { nextEligiblePlayer, seatAfter, turnTimeoutMs } from '../turns/turnOrder.ts';
import { ALL_TOOLS_INTACT, breakTool, brokenTools, isBlocked, repairTool } from './tools.ts';

describe('tools', () => {
  it('break, repeated break, repair and repair of an intact tool', () => {
    const broken = breakTool(ALL_TOOLS_INTACT, 'LAMP');
    if (!broken.ok) throw new Error('expected ok');
    expect(brokenTools(broken.value)).toEqual(['LAMP']);
    expect(isBlocked(broken.value)).toBe(true);
    expect(isBlocked(ALL_TOOLS_INTACT)).toBe(false);
    expect(breakTool(broken.value, 'LAMP')).toEqual({
      ok: false,
      error: { code: 'TOOL_ALREADY_BROKEN' },
    });
    expect(repairTool(broken.value, 'LAMP')).toEqual({ ok: true, value: ALL_TOOLS_INTACT });
    expect(repairTool(ALL_TOOLS_INTACT, 'ROPE')).toEqual({
      ok: false,
      error: { code: 'TOOL_NOT_BROKEN' },
    });
  });
});

describe('turn order', () => {
  const players = [
    { playerId: 'a', seat: 0, hasLeft: false, handCount: 2 },
    { playerId: 'b', seat: 2, hasLeft: true, handCount: 2 },
    { playerId: 'c', seat: 3, hasLeft: false, handCount: 0 },
    { playerId: 'd', seat: 5, hasLeft: false, handCount: 1 },
  ];

  it('skips left players and empty hands, wrapping by seat', () => {
    expect(nextEligiblePlayer(players, 0)).toBe('d');
    expect(nextEligiblePlayer(players, 5)).toBe('a');
  });

  it('falls back to the current player, or null when nobody can play', () => {
    expect(nextEligiblePlayer([players[0] as (typeof players)[0]], 0)).toBe('a');
    expect(
      nextEligiblePlayer(
        players.map((p) => ({ ...p, handCount: 0 })),
        0,
      ),
    ).toBeNull();
  });

  it('seatAfter wraps; AFK players get the short timeout', () => {
    expect(seatAfter([0, 2, 5], 2)).toBe(5);
    expect(seatAfter([0, 2, 5], 5)).toBe(0);
    expect(seatAfter([0, 2, 5], 3)).toBe(5);
    expect([turnTimeoutMs(0), turnTimeoutMs(1), turnTimeoutMs(2)]).toEqual([
      60_000, 60_000, 15_000,
    ]);
  });
});
