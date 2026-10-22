/**
 * Public API of the pure domain engine.
 *
 * Imported by the browser (non-authoritative UX previews) and, later, by Supabase Edge
 * Functions (authoritative). Everything reachable from here must stay host-independent
 * (see tsconfig.domain.json and the domain rules in eslint.config.js).
 */
export * from './primitives.ts';
export * from './result.ts';
export * from './errors.ts';
export { RULES_VERSION } from './version.ts';

export * from './config/board.ts';
export * from './config/deck.ts';
export * from './config/players.ts';
export * from './config/roles.ts';
export * from './config/scoring.ts';
export * from './config/timing.ts';

export * from './board/direction.ts';
export * from './board/topology.ts';
export * from './board/board.ts';
export * from './board/reachability.ts';
export * from './board/placement.ts';

export * from './cards/types.ts';
export * from './cards/catalog.ts';
export * from './deck/deck.ts';
export * from './roles/roles.ts';
export * from './hands/hand.ts';
export * from './tools/tools.ts';
export * from './turns/turnOrder.ts';
export * from './scoring/scoring.ts';

export * from './rng/rng.ts';
export { shuffle } from './rng/shuffle.ts';
export { generateCardIds } from './rng/ids.ts';

export * from './game/types.ts';
export * from './game/commands.ts';
export * from './game/events.ts';
export * from './game/createRound.ts';
export * from './game/applyCommand.ts';
export * from './game/roundEnd.ts';
export * from './game/projections.ts';
export * from './game/gameFlow.ts';
