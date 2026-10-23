import { MAX_PLAYERS, MIN_PLAYERS } from '../../domain/index.ts';

/**
 * Client-side mirrors of the server lobby rules (PRODUCT_SPEC §4) for instant feedback only.
 * The database functions private.normalize_display_name / is_valid_display_name /
 * normalize_room_code are authoritative.
 */
export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 20;
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const DEFAULT_CAPACITY = 6;

// Latin (incl. Latin-1/Extended), Greek, Cyrillic letters, ASCII digits, space, . _ -
const NAME_PATTERN = /^[A-Za-z0-9À-ÖØ-öø-ɏΆ-ώЀ-ҁҊ-ӿ ._-]+$/u;
const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function normalizeDisplayName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

export function isValidDisplayName(normalized: string): boolean {
  const length = Array.from(normalized).length;
  return (
    length >= DISPLAY_NAME_MIN_LENGTH &&
    length <= DISPLAY_NAME_MAX_LENGTH &&
    NAME_PATTERN.test(normalized)
  );
}

export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/gu, '');
}

export function isValidRoomCode(normalized: string): boolean {
  return ROOM_CODE_PATTERN.test(normalized);
}

export function isValidCapacity(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_PLAYERS && value <= MAX_PLAYERS;
}

export const CAPACITY_OPTIONS: readonly number[] = Array.from(
  { length: MAX_PLAYERS - MIN_PLAYERS + 1 },
  (_, i) => MIN_PLAYERS + i,
);
