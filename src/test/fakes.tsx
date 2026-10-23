import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { RULES_VERSION } from '../domain/index.ts';
import { AppProviders } from '../app/AppProviders.tsx';
import { routes } from '../app/routes.tsx';
import type {
  AuthGateway,
  GameApi,
  GameSnapshot,
  LobbyApi,
  LobbyPlayer,
  LobbySnapshot,
  MyGameState,
  RealtimeGateway,
  RealtimeStatus,
  RoomSubscriptionHandlers,
  Services,
} from '../lib/services/types.ts';

/** Fakes at the service boundary: no Supabase, no database emulation. */

export const ROOM_ID = 'room-1';
export const ROOM_CODE = 'ABC234';

export function player(overrides: Partial<LobbyPlayer> = {}): LobbyPlayer {
  return {
    playerId: 'p-host',
    seat: 0,
    displayName: 'Анна',
    isReady: false,
    isHost: true,
    isMe: false,
    connection: 'CONNECTED',
    ...overrides,
  };
}

export function snapshot(overrides: Partial<LobbySnapshot> = {}): LobbySnapshot {
  const players = overrides.players ?? [
    player(),
    player({ playerId: 'p-me', seat: 1, displayName: 'Борис', isHost: false, isMe: true }),
  ];
  const me = players.find((p) => p.isMe) ?? players[0];
  if (!me) throw new Error('snapshot() needs at least one player');
  return {
    serverNow: 1_700_000_000_000,
    room: {
      id: ROOM_ID,
      code: ROOM_CODE,
      status: 'LOBBY',
      capacity: 6,
      version: 1,
      hostPlayerId: 'p-host',
    },
    me: { playerId: me.playerId, seat: me.seat, isHost: me.isHost, isReady: me.isReady },
    players,
    start: {
      minPlayers: 3,
      playerCount: players.length,
      notReadyCount: players.filter((p) => !p.isHost && !p.isReady).length,
      canStart: false,
    },
    ...overrides,
  };
}

type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<(...args: A) => R>>
    : never;
};

export function createFakeServices() {
  let handlers: RoomSubscriptionHandlers | null = null;

  const auth: Mocked<AuthGateway> = {
    getSession: vi.fn(async () => ({ userId: 'user-1', isAnonymous: true })),
    signInAnonymously: vi.fn(async () => ({ userId: 'user-new', isAnonymous: true })),
    onSessionChange: vi.fn(() => () => undefined),
  };

  const lobby: Mocked<LobbyApi> = {
    createRoom: vi.fn(async () => ({ roomId: ROOM_ID, code: ROOM_CODE })),
    joinRoom: vi.fn(async () => ({ roomId: ROOM_ID, code: ROOM_CODE })),
    getSnapshot: vi.fn(async () => snapshot()),
    setReady: vi.fn(async () => snapshot()),
    leaveRoom: vi.fn(async () => undefined),
    heartbeat: vi.fn(async () => ({ roomVersion: 1 })),
    updateCapacity: vi.fn(async () => snapshot()),
    kickPlayer: vi.fn(async () => snapshot()),
    getMyActiveRoom: vi.fn(async () => null),
    resetRoom: vi.fn(async () => snapshot()),
  };

  const game: Mocked<GameApi> = {
    sendCommand: vi.fn(async (input) => ({
      ok: true as const,
      commandType: input.command.type,
      version: 2,
    })),
    getSnapshot: vi.fn(async () => gameSnapshot()),
    getMyState: vi.fn(async () => myGameState()),
  };

  const realtime: Mocked<RealtimeGateway> = {
    subscribeToRoom: vi.fn((_roomId: string, h: RoomSubscriptionHandlers) => {
      handlers = h;
      return () => {
        handlers = null;
      };
    }),
  };

  const services: Services = { auth, lobby, game, realtime };
  return {
    services,
    auth,
    lobby,
    game,
    realtime,
    emitRoomChanged: (version: number) => handlers?.onRoomChanged(version),
    emitGameChanged: (roundId: string, version: number) =>
      handlers?.onGameChanged({ roundId, version }),
    emitStatus: (status: RealtimeStatus) => handlers?.onStatus(status),
  };
}

export function renderApp(path: string, services: Services | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AppProviders services={services} queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...view, router, queryClient };
}

// ---------------------------------------------------------------------------------------------
// Game fixtures (public + private snapshots of the same round/version)
// ---------------------------------------------------------------------------------------------
export const ROUND_ID = 'round-1';

const intactTools = { DRILL: 'INTACT', LAMP: 'INTACT', ROPE: 'INTACT' } as const;

export function gameSnapshot(overrides: Partial<GameSnapshot['round']> = {}): GameSnapshot {
  return {
    serverNow: Date.now(),
    game: {
      id: 'game-1',
      status: 'IN_PROGRESS',
      currentRoundNo: 1,
      totalRounds: 3,
      endReason: null,
    },
    round: {
      id: ROUND_ID,
      roundNo: 1,
      phase: 'ROUND_ACTIVE',
      version: 1,
      resultsDeadline: null,
      result: null,
      reveal: null,
      publicState: {
        rulesVersion: RULES_VERSION,
        roundNo: 1,
        phase: 'ROUND_ACTIVE',
        version: 1,
        turnNumber: 1,
        activePlayerId: 'p-me',
        turnStartedAt: Date.now(),
        turnDeadline: Date.now() + 60_000,
        drawPileCount: 48,
        discardCount: 0,
        board: {
          paths: {},
          destinations: [
            { slot: 0, x: 8, y: -2, revealed: null },
            { slot: 1, x: 8, y: 0, revealed: null },
            { slot: 2, x: 8, y: 2, revealed: null },
          ],
        },
        players: [
          {
            playerId: 'p-host',
            seat: 0,
            handCount: 6,
            tools: intactTools,
            hasLeft: false,
            isAfk: false,
          },
          {
            playerId: 'p-me',
            seat: 1,
            handCount: 6,
            tools: intactTools,
            hasLeft: false,
            isAfk: false,
          },
          {
            playerId: 'p3',
            seat: 2,
            handCount: 6,
            tools: { ...intactTools, LAMP: 'BROKEN' },
            hasLeft: false,
            isAfk: false,
          },
        ],
        lastEventSeq: 1,
        result: null,
      },
      ...overrides,
    },
    players: [
      {
        playerId: 'p-host',
        seat: 0,
        displayName: 'Анна',
        status: 'ACTIVE',
        isMe: false,
        isHost: true,
        connection: 'CONNECTED',
      },
      {
        playerId: 'p-me',
        seat: 1,
        displayName: 'Борис',
        status: 'ACTIVE',
        isMe: true,
        isHost: false,
        connection: 'CONNECTED',
      },
      {
        playerId: 'p3',
        seat: 2,
        displayName: 'Цвета',
        status: 'ACTIVE',
        isMe: false,
        isHost: false,
        connection: 'CONNECTED',
      },
    ],
    scores: [],
    events: [{ seq: 1, type: 'ROUND_STARTED', roundNo: 1, startingSeat: 1, handSize: 6 }],
  };
}

export function myGameState(overrides: Partial<MyGameState> = {}): MyGameState {
  return {
    gameId: 'game-1',
    roundId: ROUND_ID,
    roundNo: 1,
    version: 1,
    playerId: 'p-me',
    state: {
      playerId: 'p-me',
      role: 'MINER',
      hand: [
        { id: 'c-path', typeId: 'PATH_STRAIGHT_EW', handPosition: 0 },
        { id: 'c-scout', typeId: 'SCOUT', handPosition: 1 },
      ],
      knownDestinations: [],
    },
    ...overrides,
  };
}
