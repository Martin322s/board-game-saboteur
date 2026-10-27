/**
 * DEVELOPMENT-ONLY visual preview of the game screen with in-memory fixture data (no backend).
 * Route: /__preview/game?view=turn|waiting|reveal|results|final — registered only when
 * import.meta.env.DEV, so it is not part of production builds.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { RULES_VERSION, type PlacedPath, type PublicPlayerView } from '../domain/index.ts';
import GameView from '../features/game/GameView.tsx';
import { AppError } from '../lib/errors/appError.ts';
import { ServicesProvider } from '../lib/services/ServicesContext.tsx';
import type { GameSnapshot, MyGameState, Services } from '../lib/services/types.ts';

const ROUND = 'preview-round-2';
const intact = { DRILL: 'INTACT', LAMP: 'INTACT', ROPE: 'INTACT' } as const;
const path = (
  typeId: PlacedPath['typeId'],
  x: number,
  y: number,
  rotation: 0 | 180 = 0,
): PlacedPath => ({
  cardId: `b${x}${y}`,
  typeId,
  rotation,
  x,
  y,
  placedBy: 'p1',
  placedOnTurn: 1,
});

function fixtures(view: string): { pub: GameSnapshot; mine: MyGameState } {
  const now = Date.now();
  const players: PublicPlayerView[] = [
    { playerId: 'p1', seat: 0, handCount: 6, tools: intact, hasLeft: false, isAfk: false },
    {
      playerId: 'p2',
      seat: 1,
      handCount: 6,
      tools: { ...intact, LAMP: 'BROKEN' },
      hasLeft: false,
      isAfk: false,
    },
    { playerId: 'me', seat: 2, handCount: 6, tools: intact, hasLeft: false, isAfk: false },
    {
      playerId: 'p4',
      seat: 3,
      handCount: 5,
      tools: { DRILL: 'BROKEN', LAMP: 'INTACT', ROPE: 'BROKEN' },
      hasLeft: false,
      isAfk: false,
    },
    { playerId: 'p5', seat: 4, handCount: 6, tools: intact, hasLeft: false, isAfk: true },
  ];
  const ended = view === 'results' || view === 'final';
  const active = view === 'waiting' ? 'p2' : 'me';
  const pub: GameSnapshot = {
    serverNow: now,
    game: {
      id: 'g',
      status: view === 'final' ? 'FINISHED' : 'IN_PROGRESS',
      currentRoundNo: view === 'final' ? 3 : 2,
      totalRounds: 3,
      endReason: null,
    },
    round: {
      id: ROUND,
      roundNo: view === 'final' ? 3 : 2,
      phase: ended ? 'ROUND_ENDED' : 'ROUND_ACTIVE',
      version: 14,
      resultsDeadline: ended ? now + 32_000 : null,
      result: ended
        ? { winner: 'MINER', endReason: 'TREASURE_REACHED', connectorPlayerId: 'p1' }
        : null,
      reveal: ended
        ? {
            roles: [
              { playerId: 'p1', role: 'MINER' },
              { playerId: 'p2', role: 'DISRUPTOR' },
              { playerId: 'me', role: 'MINER' },
              { playerId: 'p4', role: 'MINER' },
              { playerId: 'p5', role: 'DISRUPTOR' },
            ],
            setAsideRole: 'MINER',
            destinations: ['EMPTY', 'TREASURE', 'EMPTY'],
          }
        : null,
      publicState: {
        rulesVersion: RULES_VERSION,
        roundNo: 2,
        phase: ended ? 'ROUND_ENDED' : 'ROUND_ACTIVE',
        version: 14,
        turnNumber: 14,
        activePlayerId: ended ? null : active,
        turnStartedAt: now - 18_000,
        turnDeadline: ended ? null : now + 42_000,
        drawPileCount: 23,
        discardCount: 7,
        board: {
          paths: Object.fromEntries(
            [
              path('PATH_STRAIGHT_EW', -1, 0),
              path('PATH_STRAIGHT_EW', 1, 0),
              path('PATH_T_EWS', 2, 0),
              path('PATH_STRAIGHT_NS', 2, 1),
              path('DEAD_CROSS', 2, 2),
              path('PATH_CROSS', 3, 0),
              path('PATH_CORNER_SW', 3, -1),
              path('PATH_STRAIGHT_EW', 4, 0),
              path('DEAD_END_E', 5, 0, 180),
            ].map((p) => [`${p.x},${p.y}`, p]),
          ),
          destinations: [
            { slot: 0, x: 8, y: -2, revealed: null },
            { slot: 1, x: 8, y: 0, revealed: ended ? 'TREASURE' : null },
            { slot: 2, x: 8, y: 2, revealed: 'EMPTY' },
          ],
        },
        players,
        lastEventSeq: 20,
        result: null,
      },
    },
    players: [
      {
        playerId: 'p1',
        seat: 0,
        displayName: 'Мария',
        status: 'ACTIVE',
        isMe: false,
        isHost: true,
        connection: 'CONNECTED',
      },
      {
        playerId: 'p2',
        seat: 1,
        displayName: 'Иван',
        status: 'ACTIVE',
        isMe: false,
        isHost: false,
        connection: 'CONNECTED',
      },
      {
        playerId: 'me',
        seat: 2,
        displayName: 'Борис',
        status: 'ACTIVE',
        isMe: true,
        isHost: view === 'final',
        connection: 'CONNECTED',
      },
      {
        playerId: 'p4',
        seat: 3,
        displayName: 'Петър',
        status: 'ACTIVE',
        isMe: false,
        isHost: false,
        connection: 'DISCONNECTED',
      },
      {
        playerId: 'p5',
        seat: 4,
        displayName: 'Ели',
        status: 'ACTIVE',
        isMe: false,
        isHost: false,
        connection: 'AWAY',
      },
    ],
    scores: [
      { roundNo: 1, playerId: 'p1', points: 0, reason: 'LOST' },
      { roundNo: 1, playerId: 'p2', points: 3, reason: 'DISRUPTORS_WON' },
      { roundNo: 1, playerId: 'me', points: 0, reason: 'LOST' },
      { roundNo: 1, playerId: 'p4', points: 3, reason: 'DISRUPTORS_WON' },
      { roundNo: 1, playerId: 'p5', points: 0, reason: 'LOST' },
      ...(ended
        ? ([
            { roundNo: 2, playerId: 'p1', points: 3, reason: 'MINERS_WON_CONNECTOR' },
            { roundNo: 2, playerId: 'p2', points: 0, reason: 'LOST' },
            { roundNo: 2, playerId: 'me', points: 2, reason: 'MINERS_WON' },
            { roundNo: 2, playerId: 'p4', points: 2, reason: 'MINERS_WON' },
            { roundNo: 2, playerId: 'p5', points: 0, reason: 'LOST' },
          ] as const)
        : []),
    ],
    events: [
      {
        seq: 16,
        type: 'PATH_PLACED',
        actorId: 'p1',
        typeId: 'PATH_CROSS',
        x: 3,
        y: 0,
        rotation: 0,
      },
      {
        seq: 17,
        type: 'TOOL_BROKEN',
        actorId: 'p2',
        targetId: 'p4',
        tool: 'DRILL',
        typeId: 'BREAK_DRILL',
      },
      { seq: 18, type: 'DESTINATION_SCOUTED', actorId: 'p4', slot: 0 },
      { seq: 19, type: 'DESTINATION_REVEALED', slot: 2, identity: 'EMPTY' },
      { seq: 20, type: 'CARD_DISCARDED', actorId: 'p5' },
    ],
  };
  const mine: MyGameState = {
    gameId: 'g',
    roundId: ROUND,
    roundNo: 2,
    version: 14,
    playerId: 'me',
    state: {
      playerId: 'me',
      role: 'MINER',
      hand: [
        { id: 'h1', typeId: 'PATH_CROSS', handPosition: 20 },
        { id: 'h2', typeId: 'PATH_CORNER_SE', handPosition: 21 },
        { id: 'h3', typeId: 'DEAD_T_NSE', handPosition: 22 },
        { id: 'h4', typeId: 'BREAK_LAMP', handPosition: 23 },
        { id: 'h5', typeId: 'REPAIR_DRILL_ROPE', handPosition: 24 },
        { id: 'h6', typeId: 'SCOUT', handPosition: 25 },
      ],
      knownDestinations: [{ slot: 0, identity: 'EMPTY' }],
    },
  };
  return { pub, mine };
}

export default function GamePreview() {
  const [params] = useSearchParams();
  const view = params.get('view') ?? 'turn';
  const [services] = useState<Services>(() => {
    const { pub, mine } = fixtures(view);
    const fail = () => Promise.reject(new AppError('UNKNOWN'));
    try {
      if (view === 'reveal') sessionStorage.removeItem('tunnels.roleSeen');
      else sessionStorage.setItem('tunnels.roleSeen', ROUND);
    } catch {
      // ignore
    }
    return {
      auth: {
        getSession: async () => ({ userId: 'preview', isAnonymous: true }),
        signInAnonymously: async () => ({ userId: 'preview', isAnonymous: true }),
        onSessionChange: () => () => undefined,
      },
      lobby: {
        createRoom: fail,
        joinRoom: fail,
        getSnapshot: fail,
        setReady: fail,
        leaveRoom: fail,
        heartbeat: fail,
        updateCapacity: fail,
        kickPlayer: fail,
        getMyActiveRoom: async () => null,
        resetRoom: fail,
      },
      game: {
        getSnapshot: async () => pub,
        getMyState: async () => mine,
        sendCommand: async (input) => ({ ok: true, commandType: input.command.type, version: 14 }),
      },
      realtime: {
        subscribeToRoom: (_roomId, handlers) => {
          handlers.onStatus('SUBSCRIBED');
          return () => undefined;
        },
      },
    };
  });
  return (
    <ServicesProvider services={services}>
      <GameView roomId={`preview-${view}`} roomCode="PRV234" realtimeStatus="SUBSCRIBED" />
    </ServicesProvider>
  );
}
