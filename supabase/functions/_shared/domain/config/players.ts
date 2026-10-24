/** Player-count dependent setup (GAME_RULES §2). */

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;
export const ROUNDS_PER_GAME = 3;

export function isSupportedPlayerCount(count: number): boolean {
  return Number.isInteger(count) && count >= MIN_PLAYERS && count <= MAX_PLAYERS;
}

/** Initial hand size (GAME_RULES §2.2). Throws for unsupported counts (programmer error). */
export function handSizeFor(playerCount: number): number {
  if (!isSupportedPlayerCount(playerCount)) {
    throw new RangeError(`Unsupported player count: ${playerCount}`);
  }
  if (playerCount <= 5) return 6;
  if (playerCount <= 7) return 5;
  return 4;
}
