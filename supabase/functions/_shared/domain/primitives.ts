/**
 * Core primitive types shared by every domain module.
 *
 * Identifiers are plain strings rather than branded types: state is persisted as JSON and
 * round-tripped through Edge Functions, and plain aliases keep tests and fixtures simple.
 */

export type PlayerId = string;
export type CardId = string;
export type RoundId = string;
export type GameId = string;
export type CommandId = string;
/** Per-round integer, incremented by exactly 1 for every committed transition. */
export type StateVersion = number;
/** Server-owned, monotonically assigned position of a card in a hand (GAME_RULES §6.2). */
export type HandPosition = number;
/** Fixed seat index in the room; seat order is turn order. */
export type Seat = number;
/** Milliseconds since the Unix epoch. Always supplied by the caller (server clock). */
export type EpochMs = number;

export const ROLES = ['MINER', 'DISRUPTOR'] as const;
export type Role = (typeof ROLES)[number];

export const TOOLS = ['DRILL', 'LAMP', 'ROPE'] as const;
export type Tool = (typeof TOOLS)[number];

export const DESTINATION_IDENTITIES = ['TREASURE', 'EMPTY'] as const;
export type DestinationIdentity = (typeof DESTINATION_IDENTITIES)[number];

export const DESTINATION_SLOTS = [0, 1, 2] as const;
export type DestinationSlot = (typeof DESTINATION_SLOTS)[number];

export function isDestinationSlot(value: unknown): value is DestinationSlot {
  return value === 0 || value === 1 || value === 2;
}

export function isTool(value: unknown): value is Tool {
  return typeof value === 'string' && (TOOLS as readonly string[]).includes(value);
}
