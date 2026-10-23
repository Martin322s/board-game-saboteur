import { describe, expect, it } from 'vitest';
import {
  CAPACITY_OPTIONS,
  isValidCapacity,
  isValidDisplayName,
  isValidRoomCode,
  normalizeDisplayName,
  normalizeRoomCode,
} from './validation.ts';

describe('display names (client mirror of the server rule)', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeDisplayName('  Иван   Петров \t')).toBe('Иван Петров');
  });

  it.each(['Мария', 'Zoë', 'Player_1', 'И.П.', 'Ана-Мария', 'Ab'])('accepts %s', (name) => {
    expect(isValidDisplayName(normalizeDisplayName(name))).toBe(true);
  });

  it.each(['', ' ', 'A', '<b>x</b>', 'name😀', 'a'.repeat(21), 'tab‮evil', 'x"y'])(
    'rejects %j',
    (name) => {
      expect(isValidDisplayName(normalizeDisplayName(name))).toBe(false);
    },
  );
});

describe('room codes', () => {
  it('normalizes case, spaces and dashes', () => {
    expect(normalizeRoomCode(' abc-234 ')).toBe('ABC234');
  });

  it.each([
    ['ABC234', true],
    ['abc234', false], // must be normalized first
    ['ABC23', false],
    ['ABCO23', false], // O is excluded
    ['ABC120', false], // 1 and 0 are excluded
    ['ABCDEFG', false],
  ])('%s valid=%s', (code, valid) => {
    expect(isValidRoomCode(code)).toBe(valid);
  });
});

describe('capacity', () => {
  it('allows 3–10 only', () => {
    expect(CAPACITY_OPTIONS).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect([2, 3, 10, 11, 4.5].map(isValidCapacity)).toEqual([false, true, true, false, false]);
  });
});
