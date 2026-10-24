/** Turn/result timing (GAME_RULES §8.5, §9.4). All values in milliseconds. */

export const TURN_TIMEOUT_MS = 60_000;
export const AFK_TURN_TIMEOUT_MS = 15_000;
/** Consecutive timed-out turns after which a player is treated as AFK. */
export const AFK_THRESHOLD = 2;
export const RESULTS_AUTO_ADVANCE_MS = 45_000;
