import {
  applyCommand,
  createRound,
  decideAfterRound,
  projectPrivate,
  projectPublic,
  projectReveal,
  ROUNDS_PER_GAME,
  RULES_VERSION,
  type DomainError,
  type GameCommand,
  type PublicEvent,
  type RoundState,
} from '../domain/index.ts';
import type {
  CommandMeta,
  GameStore,
  PersistResult,
  RoundPayload,
  ServerContext,
  ServerFailure,
} from './store.ts';

/**
 * The authoritative gameplay command pipeline (ARCHITECTURE §8). Host-neutral: no Deno, Node or
 * browser globals; identity, persistence and randomness are injected.
 *
 *   authenticated user → validate request → rules version → context (membership, rate limit,
 *   command log, secrets, DB time) → idempotent replay → pure domain → projections →
 *   compare-and-swap persistence → safe response
 *
 * Nothing in the request is trusted except the intent: the actor, their seat, card ownership,
 * turn, time and randomness all come from the server.
 */

export const LIFECYCLE_COMMANDS = ['START_GAME', 'START_NEXT_ROUND'] as const;
export const ROUND_COMMANDS = [
  'PLAY_PATH',
  'PLAY_ACTION',
  'DISCARD',
  'RESOLVE_EXPIRED_TURN',
  'LEAVE',
] as const;
export type CommandType = (typeof LIFECYCLE_COMMANDS)[number] | (typeof ROUND_COMMANDS)[number];

export interface CommandRequest {
  readonly roomId: string;
  readonly commandId: string;
  readonly expectedVersion?: number;
  readonly command: { readonly type: CommandType } & Readonly<Record<string, unknown>>;
}

export interface HandlerInput {
  /** Verified from the JWT by the caller (Edge entry); null when unauthenticated. */
  readonly userId: string | null;
  /** Value of the `x-rules-version` header. */
  readonly rulesVersion: string | null;
  readonly body: unknown;
}

export interface HandlerDeps {
  readonly store: GameStore;
  /** Cryptographically secure production seed (Edge: crypto.getRandomValues). */
  readonly generateSeed: () => string;
}

export interface HandlerResult {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALL_COMMANDS: readonly string[] = [...LIFECYCLE_COMMANDS, ...ROUND_COMMANDS];
const VERSIONED_COMMANDS: readonly string[] = [
  'PLAY_PATH',
  'PLAY_ACTION',
  'DISCARD',
  'RESOLVE_EXPIRED_TURN',
];

const fail = (
  error: string,
  extra: { status?: number; currentVersion?: number; remainingMs?: number } = {},
): HandlerResult => {
  const { status = 200, ...details } = extra;
  return { status, body: { ok: false, error, ...details } };
};

const failDomain = (error: DomainError): HandlerResult =>
  fail(error.code, {
    ...(error.currentVersion !== undefined ? { currentVersion: error.currentVersion } : {}),
    ...(error.remainingMs !== undefined ? { remainingMs: error.remainingMs } : {}),
  });

const failServer = (failure: ServerFailure): HandlerResult =>
  fail(
    failure.error,
    failure.currentVersion !== undefined ? { currentVersion: failure.currentVersion } : {},
  );

export function parseCommandRequest(body: unknown): CommandRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const command = b.command as Record<string, unknown> | undefined;
  if (typeof b.roomId !== 'string' || !UUID.test(b.roomId)) return null;
  if (typeof b.commandId !== 'string' || !UUID.test(b.commandId)) return null;
  if (b.expectedVersion !== undefined && !Number.isInteger(b.expectedVersion)) return null;
  if (typeof command !== 'object' || command === null) return null;
  if (typeof command.type !== 'string' || !ALL_COMMANDS.includes(command.type)) return null;
  if (VERSIONED_COMMANDS.includes(command.type) && b.expectedVersion === undefined) return null;
  return b as unknown as CommandRequest;
}

/** Deterministic JSON (sorted keys) used to detect incompatible command-id reuse. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function handleGameCommand(
  input: HandlerInput,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  if (!input.userId) return fail('UNAUTHENTICATED', { status: 401 });
  if (input.rulesVersion !== String(RULES_VERSION)) return fail('CLIENT_OUTDATED');
  const request = parseCommandRequest(input.body);
  if (!request) return fail('INVALID_REQUEST');

  const call: Call = {
    request,
    userId: input.userId,
    fingerprint: canonicalJson({
      roomId: request.roomId,
      expectedVersion: request.expectedVersion ?? null,
      command: request.command,
    }),
    deps,
  };

  const ctx = await deps.store.loadContext({
    userId: call.userId,
    roomId: request.roomId,
    commandId: request.commandId,
    rateLimit: true,
  });
  if (!ctx.ok) return failServer(ctx);
  const replay = replayOf(ctx, call);
  if (replay) return replay;

  switch (request.command.type) {
    case 'START_GAME':
      return startGame(ctx, call);
    case 'START_NEXT_ROUND':
      return startNextRound(ctx, call);
    default:
      return roundCommand(ctx, call);
  }
}

interface Call {
  readonly request: CommandRequest;
  readonly userId: string;
  readonly fingerprint: string;
  readonly deps: HandlerDeps;
}

/** Idempotency: the same command id from the same user with the same payload replays. */
function replayOf(ctx: ServerContext, call: Call): HandlerResult | null {
  const logged = ctx.loggedCommand;
  if (!logged) return null;
  if (
    logged.userId === call.userId &&
    logged.roomId === call.request.roomId &&
    logged.fingerprint === call.fingerprint
  ) {
    return { status: 200, body: { ...logged.response, replayed: true } };
  }
  return fail('COMMAND_ID_REUSED');
}

function meta(
  call: Call,
  expectedVersion: number | null,
  response: Record<string, unknown>,
): CommandMeta {
  return {
    userId: call.userId,
    roomId: call.request.roomId,
    commandId: call.request.commandId,
    commandType: call.request.command.type,
    fingerprint: call.fingerprint,
    expectedVersion,
    response,
  };
}

function roundPayload(state: RoundState): RoundPayload {
  return {
    roundNo: state.roundNo,
    version: state.version,
    phase: state.phase,
    activePlayerId: state.activePlayerId,
    turnNumber: state.turnNumber,
    turnDeadline: state.turnDeadline,
    startingSeat: state.startingSeat,
    lastEventSeq: state.lastEventSeq,
    publicState: projectPublic(state),
    state,
  };
}

const privateStatesOf = (state: RoundState) =>
  state.players.map((p) => ({ playerId: p.playerId, state: projectPrivate(state, p.playerId) }));

/**
 * Persist, and on any conflict re-read: a concurrent identical retry that already committed is
 * replayed; otherwise the stable failure is returned.
 */
async function persistOrRecover(
  call: Call,
  persist: () => Promise<PersistResult>,
  onStale?: (fresh: ServerContext) => HandlerResult | null,
): Promise<HandlerResult> {
  let result: PersistResult | null;
  try {
    result = await persist();
    if (result.ok) return { status: 200, body: result.response };
  } catch {
    result = null;
  }
  const fresh = await call.deps.store.loadContext({
    userId: call.userId,
    roomId: call.request.roomId,
    commandId: call.request.commandId,
    rateLimit: false,
  });
  if (fresh.ok) {
    const replay = replayOf(fresh, call);
    if (replay) return replay;
    if (result && result.error === 'STALE_STATE' && onStale) {
      const mapped = onStale(fresh);
      if (mapped) return mapped;
    }
  }
  return result ? failServer(result) : fail('INTERNAL', { status: 500 });
}

async function startGame(ctx: ServerContext, call: Call): Promise<HandlerResult> {
  // Early, user-friendly checks; the SQL persistence re-validates everything under a lock.
  if (ctx.room.status === 'IN_GAME' || ctx.game?.status === 'IN_PROGRESS') {
    return fail('GAME_ALREADY_STARTED');
  }
  if (ctx.room.status !== 'LOBBY') return fail('NOT_IN_LOBBY');
  if (!ctx.me.isHost) return fail('NOT_HOST');

  const seed = call.deps.generateSeed();
  const players = ctx.members.map((m) => ({ playerId: m.playerId, seat: m.seat }));
  const created = createRound({
    players,
    roundNo: 1,
    seed,
    previousStartingSeat: null,
    now: ctx.serverNow,
  });
  if (!created.ok) return fail('NOT_ENOUGH_PLAYERS');
  const state = created.value.state;

  return persistOrRecover(call, () =>
    call.deps.store.persistStart({
      ...meta(call, null, { ok: true, commandType: 'START_GAME' }),
      playerIds: players.map((p) => p.playerId),
      rulesVersion: RULES_VERSION,
      seed,
      round: roundPayload(state),
      privateStates: privateStatesOf(state),
      events: created.value.events,
    }),
  );
}

async function startNextRound(ctx: ServerContext, call: Call): Promise<HandlerResult> {
  const { game, round } = ctx;
  if (!game) return fail('GAME_NOT_STARTED');
  if (game.status !== 'IN_PROGRESS') return fail('GAME_NOT_IN_PROGRESS');
  if (!round || round.phase !== 'ROUND_ENDED') return fail('ROUND_NOT_FINISHED');
  if (!ctx.me.isHost && (round.resultsDeadline === null || ctx.serverNow < round.resultsDeadline)) {
    return fail('RESULTS_NOT_EXPIRED');
  }

  const response = { ok: true, commandType: 'START_NEXT_ROUND' };
  if (decideAfterRound(round.roundNo, ctx.members.length) === 'FINISH_GAME') {
    return persistOrRecover(call, () =>
      call.deps.store.persistNextRound({
        ...meta(call, null, response),
        gameId: game.id,
        previousRoundNo: round.roundNo,
        finish: true,
        endReason: round.roundNo >= ROUNDS_PER_GAME ? 'COMPLETED' : 'INSUFFICIENT_PLAYERS',
      }),
    );
  }

  const seed = call.deps.generateSeed();
  const players = ctx.members.map((m) => ({ playerId: m.playerId, seat: m.seat }));
  const created = createRound({
    players,
    roundNo: round.roundNo + 1,
    seed,
    previousStartingSeat: round.startingSeat,
    now: ctx.serverNow,
  });
  if (!created.ok) return fail('NOT_ENOUGH_PLAYERS');
  const state = created.value.state;

  return persistOrRecover(call, () =>
    call.deps.store.persistNextRound({
      ...meta(call, null, response),
      gameId: game.id,
      previousRoundNo: round.roundNo,
      finish: false,
      playerIds: players.map((p) => p.playerId),
      rulesVersion: RULES_VERSION,
      seed,
      round: roundPayload(state),
      privateStates: privateStatesOf(state),
      events: created.value.events,
    }),
  );
}

async function roundCommand(ctx: ServerContext, call: Call): Promise<HandlerResult> {
  const { game, round, secret } = ctx;
  const command = call.request.command as unknown as GameCommand;
  if (!game) return fail('GAME_NOT_STARTED');
  if (game.status !== 'IN_PROGRESS') return fail('GAME_NOT_IN_PROGRESS');

  if (!round || !secret || round.phase === 'ROUND_ENDED') {
    if (command.type === 'LEAVE' && round) {
      return persistOrRecover(call, () =>
        call.deps.store.persistLeaveEnded(meta(call, null, { ok: true, commandType: 'LEAVE' })),
      );
    }
    return fail(
      command.type === 'RESOLVE_EXPIRED_TURN' ? 'TURN_ALREADY_RESOLVED' : 'ROUND_NOT_ACTIVE',
    );
  }

  const me = ctx.me.playerId;
  const expectedVersion = call.request.expectedVersion;
  const result = applyCommand(secret.state, me, command, {
    now: ctx.serverNow,
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  });
  if (!result.ok) return failDomain(result.error);

  const { state: next, events, privateEffects, roundScores } = result.value;
  const remaining = next.players.filter((p) => !p.hasLeft).length;
  const finish =
    roundScores !== null && decideAfterRound(next.roundNo, remaining) === 'FINISH_GAME';
  const response = {
    ok: true,
    commandType: command.type,
    gameId: game.id,
    roundId: round.id,
    version: next.version,
    // Only the caller's own private effects (e.g. their scout result or drawn card).
    private: privateEffects.filter((e) => e.playerId === me),
  };

  return persistOrRecover(
    call,
    () =>
      call.deps.store.persistTransition({
        ...meta(call, secret.version, response),
        // CAS always uses the version this decision was computed from.
        expectedVersion: secret.version,
        gameId: game.id,
        roundId: round.id,
        round: roundPayload(next),
        privateStates: privateStatesOf(next),
        events: events as readonly PublicEvent[],
        roundEnd:
          roundScores === null || !next.result
            ? null
            : {
                winner: next.result.winner,
                endReason: next.result.endReason,
                connectorId: next.result.connectorId,
                endedAt: next.result.endedAt,
                resultsDeadline: next.result.resultsDeadline,
                reveal: projectReveal(next),
                scores: roundScores,
              },
        gameFinish: finish
          ? { endReason: next.roundNo >= ROUNDS_PER_GAME ? 'COMPLETED' : 'INSUFFICIENT_PLAYERS' }
          : null,
        leftPlayerIds: command.type === 'LEAVE' ? [me] : [],
      }),
    (fresh) => {
      // A racing request committed first. For timeout resolution that means "already resolved".
      if (command.type === 'RESOLVE_EXPIRED_TURN') {
        const sameTurn =
          fresh.round?.id === round.id &&
          fresh.round.phase === 'ROUND_ACTIVE' &&
          fresh.round.turnNumber === command.expectedTurnNumber;
        if (!sameTurn) return fail('TURN_ALREADY_RESOLVED');
      }
      return fail('STALE_STATE', fresh.round ? { currentVersion: fresh.round.version } : {});
    },
  );
}
