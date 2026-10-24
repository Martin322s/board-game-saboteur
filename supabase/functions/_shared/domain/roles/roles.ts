import { isSupportedPlayerCount } from '../config/players.ts';
import { ROLE_POOLS } from '../config/roles.ts';
import { domainError, type DomainError } from '../errors.ts';
import type { Role } from '../primitives.ts';
import { err, ok, type Result } from '../result.ts';
import type { Rng } from '../rng/rng.ts';
import { shuffle } from '../rng/shuffle.ts';

/** Unshuffled role pool [MINER × m, DISRUPTOR × d] of size N + 1 (GAME_RULES §2.1). */
export function buildRolePool(playerCount: number): Result<Role[], DomainError> {
  const spec = ROLE_POOLS[playerCount];
  if (!isSupportedPlayerCount(playerCount) || !spec) {
    return err(domainError('INVALID_PLAYER_COUNT'));
  }
  return ok([
    ...Array.from({ length: spec.miners }, (): Role => 'MINER'),
    ...Array.from({ length: spec.disruptors }, (): Role => 'DISRUPTOR'),
  ]);
}

export interface RoleDeal {
  /** dealt[i] belongs to the player at seat-ordered list index i. */
  readonly dealt: readonly Role[];
  /** The one token set aside unseen. SERVER-ONLY until the round ends. */
  readonly setAside: Role;
}

/** Shuffle the pool and deal one token per player; the last token is set aside (§2.3 step 2). */
export function dealRoles(playerCount: number, rng: Rng): Result<RoleDeal, DomainError> {
  const pool = buildRolePool(playerCount);
  if (!pool.ok) return pool;
  const shuffled = shuffle(pool.value, rng);
  return ok({ dealt: shuffled.slice(0, playerCount), setAside: shuffled[playerCount] as Role });
}
