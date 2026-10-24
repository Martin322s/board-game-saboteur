/**
 * Role pool per player count (GAME_RULES §2.1). The pool has N + 1 tokens;
 * one is set aside unseen each round. Balance-tunable.
 */
export interface RolePoolSpec {
  readonly miners: number;
  readonly disruptors: number;
}

export const ROLE_POOLS: Readonly<Record<number, RolePoolSpec>> = {
  3: { miners: 3, disruptors: 1 },
  4: { miners: 4, disruptors: 1 },
  5: { miners: 4, disruptors: 2 },
  6: { miners: 5, disruptors: 2 },
  7: { miners: 5, disruptors: 3 },
  8: { miners: 6, disruptors: 3 },
  9: { miners: 7, disruptors: 3 },
  10: { miners: 7, disruptors: 4 },
};
