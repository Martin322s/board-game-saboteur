import { describe, expect, it, vi } from 'vitest';
import { createRound, RULES_VERSION, type RoundState } from '../domain/index.ts';
import { canonicalJson, handleGameCommand, type HandlerDeps } from './handler.ts';
import { handleGameHttp } from './http.ts';
import type { GameStore, ServerContext } from './store.ts';

const ROOM = '11111111-1111-4111-8111-111111111111';
const CMD = '22222222-2222-4222-8222-222222222222';
const NOW = 1_700_000_000_000;

function round(): RoundState {
  const created = createRound({
    players: [0, 1, 2].map((seat) => ({ playerId: `p${seat}`, seat })),
    roundNo: 1,
    seed: 'handler-test',
    previousStartingSeat: null,
    now: NOW,
  });
  if (!created.ok) throw new Error(created.error.code);
  return { ...created.value.state, activePlayerId: 'p0' };
}

function context(overrides: Partial<ServerContext> = {}, state = round()): ServerContext {
  return {
    ok: true,
    serverNow: NOW + 1_000,
    me: { playerId: 'p1', seat: 1, isHost: false },
    room: { id: ROOM, status: 'IN_GAME', version: 3, hostPlayerId: 'p0' },
    members: [0, 1, 2].map((seat) => ({ playerId: `p${seat}`, seat, isReady: true })),
    loggedCommand: null,
    game: { id: 'g1', status: 'IN_PROGRESS', currentRoundNo: 1, totalRounds: 3 },
    round: {
      id: 'r1',
      roundNo: 1,
      phase: 'ROUND_ACTIVE',
      version: state.version,
      turnNumber: state.turnNumber,
      startingSeat: state.startingSeat,
      resultsDeadline: null,
    },
    secret: { version: state.version, state },
    ...overrides,
  };
}

function fakeStore(ctx: ServerContext | ServerContext[]) {
  const contexts = Array.isArray(ctx) ? [...ctx] : [ctx];
  const store = {
    loadContext: vi.fn(async () => (contexts.length > 1 ? contexts.shift()! : contexts[0]!)),
    persistStart: vi.fn(async (_payload: unknown) => ({
      ok: true as const,
      response: { ok: true },
    })),
    persistTransition: vi.fn(async (p: { response: Record<string, unknown> }) => ({
      ok: true as const,
      response: p.response,
    })),
    persistNextRound: vi.fn(async (_payload: unknown) => ({
      ok: true as const,
      response: { ok: true },
    })),
    persistLeaveEnded: vi.fn(async (_payload: unknown) => ({
      ok: true as const,
      response: { ok: true },
    })),
  } satisfies GameStore;
  return store;
}

const deps = (store: GameStore): HandlerDeps => ({ store, generateSeed: () => 'seed' });
const body = (command: Record<string, unknown>, expectedVersion?: number) => ({
  roomId: ROOM,
  commandId: CMD,
  command,
  ...(expectedVersion === undefined ? {} : { expectedVersion }),
});
const send = (
  store: GameStore,
  b: unknown,
  userId: string | null = 'user-1',
  rulesVersion = String(RULES_VERSION),
) => handleGameCommand({ userId, rulesVersion, body: b }, deps(store));

describe('request gate', () => {
  it('rejects missing identity, outdated clients and malformed requests before touching the store', async () => {
    const store = fakeStore(context());
    expect(await send(store, body({ type: 'LEAVE' }), null)).toEqual({
      status: 401,
      body: { ok: false, error: 'UNAUTHENTICATED' },
    });
    expect((await send(store, body({ type: 'LEAVE' }), 'u', '0')).body.error).toBe(
      'CLIENT_OUTDATED',
    );
    expect((await send(store, { ...body({ type: 'LEAVE' }), roomId: 'nope' })).body.error).toBe(
      'INVALID_REQUEST',
    );
    expect((await send(store, body({ type: 'DISCARD', cardId: 'x' }))).body.error).toBe(
      'INVALID_REQUEST',
    ); // no expectedVersion
    expect((await send(store, body({ type: 'HACK' }))).body.error).toBe('INVALID_REQUEST');
    expect(store.loadContext).not.toHaveBeenCalled();
  });

  it('fingerprints requests independently of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }),
    );
  });
});

describe('idempotency', () => {
  it('replays a logged command with the same payload and rejects incompatible reuse', async () => {
    const b = body({ type: 'LEAVE' });
    const fingerprint = canonicalJson({
      roomId: ROOM,
      expectedVersion: null,
      command: { type: 'LEAVE' },
    });
    const logged = {
      userId: 'user-1',
      roomId: ROOM,
      fingerprint,
      response: { ok: true, version: 9 },
    };
    const store = fakeStore(context({ loggedCommand: logged }));

    expect((await send(store, b)).body).toEqual({ ok: true, version: 9, replayed: true });
    expect((await send(store, body({ type: 'DISCARD', cardId: 'c' }, 1))).body.error).toBe(
      'COMMAND_ID_REUSED',
    );
    expect((await send(store, b, 'someone-else')).body.error).toBe('COMMAND_ID_REUSED');
    expect(store.persistTransition).not.toHaveBeenCalled();
  });
});

describe('round commands', () => {
  it('derives the actor from the session, uses the loaded version for CAS and persists every projection', async () => {
    const state = round();
    const store = fakeStore(context({ me: { playerId: 'p0', seat: 0, isHost: true } }, state));
    const cardId = state.players[0]!.hand.cards[0]!.id;
    const result = await send(store, body({ type: 'DISCARD', cardId }, state.version));

    expect(result.body).toMatchObject({ ok: true, version: 2, commandType: 'DISCARD' });
    const payload = store.persistTransition.mock.calls[0]![0] as unknown as Record<
      string,
      unknown
    > & {
      privateStates: unknown[];
      round: { publicState: unknown };
    };
    expect(payload).toMatchObject({
      expectedVersion: 1,
      gameId: 'g1',
      roundId: 'r1',
      roundEnd: null,
    });
    expect(payload.privateStates).toHaveLength(3);
    expect(JSON.stringify(payload.round.publicState)).not.toMatch(/MINER|DISRUPTOR|"role"/);
  });

  it('a non-active caller is rejected by the domain (actor is never taken from the request)', async () => {
    const state = round();
    const store = fakeStore(context({}, state)); // me = p1, active = p0
    const cardId = state.players[0]!.hand.cards[0]!.id;
    const result = await send(store, body({ type: 'DISCARD', cardId, playerId: 'p0' }, 1));
    expect(result.body.error).toBe('NOT_YOUR_TURN');
    expect(store.persistTransition).not.toHaveBeenCalled();
  });

  it("timeout resolution never returns the timed-out player's drawn card to the requester", async () => {
    const state = { ...round(), turnDeadline: NOW };
    const store = fakeStore(context({}, state));
    const result = await send(
      store,
      body({ type: 'RESOLVE_EXPIRED_TURN', expectedTurnNumber: 1 }, 1),
    );
    expect(result.body).toMatchObject({ ok: true, private: [] });
  });

  it('maps a lost timeout race to TURN_ALREADY_RESOLVED', async () => {
    const state = { ...round(), turnDeadline: NOW };
    const before = context({}, state);
    const after = context({ round: { ...before.round!, version: 2, turnNumber: 2 } }, state);
    const store = fakeStore([before, after]);
    store.persistTransition.mockResolvedValueOnce({
      ok: false,
      error: 'STALE_STATE',
      currentVersion: 2,
    } as never);
    const result = await send(
      store,
      body({ type: 'RESOLVE_EXPIRED_TURN', expectedTurnNumber: 1 }, 1),
    );
    expect(result.body.error).toBe('TURN_ALREADY_RESOLVED');
  });

  it('after the round ended, play commands are rejected and LEAVE uses the ended-round path', async () => {
    const ended = context({ secret: null, round: { ...context().round!, phase: 'ROUND_ENDED' } });
    const store = fakeStore(ended);
    expect((await send(store, body({ type: 'DISCARD', cardId: 'c' }, 1))).body.error).toBe(
      'ROUND_NOT_ACTIVE',
    );
    expect(
      (await send(store, body({ type: 'RESOLVE_EXPIRED_TURN', expectedTurnNumber: 1 }, 1))).body
        .error,
    ).toBe('TURN_ALREADY_RESOLVED');
    expect((await send(store, body({ type: 'LEAVE' }))).body.ok).toBe(true);
    expect(store.persistLeaveEnded).toHaveBeenCalledTimes(1);
  });
});

describe('lifecycle commands', () => {
  it('only the host may start; the server seed and DB time build the round', async () => {
    const lobby = context({
      room: { id: ROOM, status: 'LOBBY', version: 1, hostPlayerId: 'p0' },
      game: null,
      round: null,
      secret: null,
    });
    const store = fakeStore(lobby);
    expect((await send(store, body({ type: 'START_GAME' }))).body.error).toBe('NOT_HOST');

    const hostStore = fakeStore({ ...lobby, me: { playerId: 'p0', seat: 0, isHost: true } });
    expect((await send(hostStore, body({ type: 'START_GAME', seed: 'client-seed' }))).body.ok).toBe(
      true,
    );
    const payload = hostStore.persistStart.mock.calls[0]![0] as unknown as {
      seed: string;
      round: { turnDeadline: number };
      playerIds: string[];
    };
    expect(payload.seed).toBe('seed'); // never the client's
    expect(payload.round.turnDeadline).toBe(NOW + 1_000 + 60_000);
    expect(payload.playerIds).toEqual(['p0', 'p1', 'p2']);
  });

  it('a non-host may start the next round only after the results deadline', async () => {
    const ended = {
      secret: null,
      round: { ...context().round!, phase: 'ROUND_ENDED' as const, resultsDeadline: NOW + 5_000 },
    };
    expect(
      (await send(fakeStore(context(ended)), body({ type: 'START_NEXT_ROUND' }))).body.error,
    ).toBe('RESULTS_NOT_EXPIRED');
    const later = fakeStore(context({ ...ended, serverNow: NOW + 5_000 }));
    expect((await send(later, body({ type: 'START_NEXT_ROUND' }))).body.ok).toBe(true);
    expect(later.persistNextRound.mock.calls[0]![0]).toMatchObject({
      finish: false,
      previousRoundNo: 1,
    });
  });
});

describe('http layer', () => {
  const httpDeps = (store: GameStore) => ({
    ...deps(store),
    authenticate: async (token: string) => (token === 'good' ? 'user-1' : null),
    allowedOrigins: ['http://localhost:5173'],
  });

  it('answers CORS preflight only for allowed origins and rejects other methods', async () => {
    const store = fakeStore(context());
    const ok = await handleGameHttp(
      new Request('http://x', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } }),
      httpDeps(store),
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(ok.headers.get('Access-Control-Allow-Headers')).toContain('x-rules-version');
    const evil = await handleGameHttp(
      new Request('http://x', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }),
      httpDeps(store),
    );
    expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(
      (await handleGameHttp(new Request('http://x', { method: 'GET' }), httpDeps(store))).status,
    ).toBe(405);
  });

  it('authenticates the bearer token and passes the rules version header through', async () => {
    const store = fakeStore(context());
    const request = (token: string) =>
      new Request('http://x', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'x-rules-version': String(RULES_VERSION) },
        body: JSON.stringify(body({ type: 'LEAVE' })),
      });
    expect((await handleGameHttp(request('bad'), httpDeps(store))).status).toBe(401);
    const res = await handleGameHttp(request('good'), httpDeps(store));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, commandType: 'LEAVE' });
  });
});
