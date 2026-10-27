import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathTopology, type CardTypeId } from '../../domain/index.ts';
import { AppError } from '../../lib/errors/appError.ts';
import type { GameSnapshot, MyGameState } from '../../lib/services/types.ts';
import {
  createFakeServices,
  gameSnapshot,
  myGameState,
  player,
  renderApp,
  ROOM_CODE,
  ROOM_ID,
  ROUND_ID,
  snapshot,
} from '../../test/fakes.tsx';
import { TunnelTile } from './art/TunnelArt.tsx';

type PublicState = GameSnapshot['round']['publicState'];
const inGame = () => snapshot({ room: { ...snapshot().room, status: 'IN_GAME' } });
const withState = (patch: Partial<PublicState>, round: Partial<GameSnapshot['round']> = {}) => {
  const base = gameSnapshot(round);
  return {
    ...base,
    round: { ...base.round, publicState: { ...base.round.publicState, ...patch } },
  };
};
const withHand = (...typeIds: CardTypeId[]): MyGameState => {
  const base = myGameState();
  return {
    ...base,
    state: {
      ...base.state,
      hand: typeIds.map((typeId, i) => ({ id: `c${i}`, typeId, handPosition: i })),
    },
  };
};
const brokenTools = (
  overrides: Record<string, Partial<Record<'DRILL' | 'LAMP' | 'ROPE', 'BROKEN'>>>,
) =>
  gameSnapshot().round.publicState.players.map((p) => ({
    ...p,
    tools: {
      DRILL: 'INTACT',
      LAMP: 'INTACT',
      ROPE: 'INTACT',
      ...(overrides[p.playerId] ?? {}),
    } as const,
  }));

async function openGame(
  fake = createFakeServices(),
  {
    pub,
    mine,
    seenRole = true,
  }: { pub?: GameSnapshot; mine?: MyGameState; seenRole?: boolean } = {},
) {
  if (seenRole) sessionStorage.setItem('tunnels.roleSeen', ROUND_ID);
  fake.lobby.getSnapshot.mockResolvedValue(inGame());
  if (pub) fake.game.getSnapshot.mockResolvedValue(pub);
  if (mine) fake.game.getMyState.mockResolvedValue(mine);
  renderApp(`/r/${ROOM_CODE}`, fake.services);
  await screen.findByRole('list', { name: 'Твоите карти' });
  return fake;
}
const hand = () => within(screen.getByRole('list', { name: 'Твоите карти' }));
const sent = (fake: ReturnType<typeof createFakeServices>) =>
  fake.game.sendCommand.mock.calls.map((c) => c[0]);

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('starting a game from the lobby', () => {
  it('the host gets an enabled start control once the server says the room can start', async () => {
    const fake = createFakeServices();
    fake.lobby.getSnapshot.mockResolvedValue(
      snapshot({
        players: [
          player({ isMe: true }),
          player({ playerId: 'p2', seat: 1, displayName: 'Борис', isHost: false, isReady: true }),
          player({ playerId: 'p3', seat: 2, displayName: 'Цвета', isHost: false, isReady: true }),
        ],
        start: { minPlayers: 3, playerCount: 3, notReadyCount: 0, canStart: true },
      }),
    );
    renderApp(`/r/${ROOM_CODE}`, fake.services);
    fireEvent.click(await screen.findByRole('button', { name: 'Започни играта' }));
    await waitFor(() =>
      expect(fake.game.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ roomId: ROOM_ID, command: { type: 'START_GAME' } }),
      ),
    );
  });
});

describe('tunnel renderer', () => {
  it('draws exactly the topology: connected passages meet at a hub, dead ends stop at blockers', () => {
    const { container, rerender } = render(
      <TunnelTile topology={pathTopology('PATH_STRAIGHT_EW', 0)} />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName('Тунел: изток, запад');
    expect(container.querySelectorAll('[data-part="passage"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-part="hub"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-part="blocker"]')).toHaveLength(0);

    rerender(<TunnelTile topology={pathTopology('DEAD_CORNER_SE', 0)} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Задънен тунел: изток, юг');
    expect(container.querySelectorAll('[data-part="hub"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-part="blocker"]')).toHaveLength(2);

    rerender(<TunnelTile topology={pathTopology('PATH_CORNER_SE', 180)} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Тунел: север, запад');
  });
});

describe('game screen', () => {
  it('shows a deliberate role reveal at round start, then a compact private role chip', async () => {
    await openGame(undefined, { seenRole: false });
    const dialog = screen.getByRole('dialog', { name: 'Рунд 1 от 3' });
    expect(dialog).not.toHaveTextContent('Джудже');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Виж ролята си' }));
    expect(within(dialog).getByText('Ти си джудже')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Готов съм' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const chip = screen.getByRole('button', { name: 'Твоята роля' });
    fireEvent.click(chip);
    expect(chip).toHaveTextContent('Твоята роля: Джудже');
    expect(screen.getByText('ТВОЙ ХОД')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/MINER|DISRUPTOR|PLAY_PATH|PLAY_ACTION/);
  });

  it('highlights only legal cells for the selected tunnel and places with one click on desktop', async () => {
    const fake = await openGame();
    fireEvent.click(hand().getByRole('button', { name: 'Тунел' }));
    const cells = screen
      .getAllByRole('button', { name: /^Постави тук/ })
      .map((b) => b.getAttribute('aria-label'));
    expect(cells.sort()).toEqual(['Постави тук: колона 1, ред 0']);
    fireEvent.click(screen.getByRole('button', { name: 'Постави тук: колона 1, ред 0' }));
    await waitFor(() => expect(sent(fake)).toHaveLength(1));
    expect(sent(fake)[0]).toMatchObject({
      roomId: ROOM_ID,
      expectedVersion: 1,
      command: { type: 'PLAY_PATH', cardId: 'c-path', x: 1, y: 0, rotation: 0 },
    });
  });

  it('rotates 180° with R and re-computes legal cells', async () => {
    await openGame(undefined, { mine: withHand('PATH_CORNER_SW') });
    fireEvent.click(hand().getByRole('button', { name: 'Тунел' }));
    const labels = () =>
      screen
        .getAllByRole('button', { name: /^Постави тук/ })
        .map((b) => b.getAttribute('aria-label'))
        .sort();
    expect(labels()).toEqual(['Постави тук: колона 0, ред -1', 'Постави тук: колона 1, ред 0']);
    fireEvent.keyDown(window, { key: 'r', code: 'KeyR' });
    expect(labels()).toEqual(['Постави тук: колона 0, ред 1']);
  });

  it('asks for confirmation before placing on touch devices', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('coarse'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const fake = await openGame();
    fireEvent.click(hand().getByRole('button', { name: 'Тунел' }));
    fireEvent.click(screen.getByRole('button', { name: 'Постави тук: колона 1, ред 0' }));
    expect(fake.game.sendCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Постави' }));
    await waitFor(() =>
      expect(sent(fake)[0]).toMatchObject({ command: { type: 'PLAY_PATH', x: 1, y: 0 } }),
    );
  });

  it('break: only players with that tool intact are offered, then the choice is confirmed', async () => {
    const pub = withState({ players: brokenTools({ p3: { LAMP: 'BROKEN' } }) });
    const fake = await openGame(undefined, { pub, mine: withHand('BREAK_LAMP') });
    fireEvent.click(hand().getByRole('button', { name: 'Счупи лампа' }));
    expect(screen.getAllByRole('button', { name: 'Избери Анна' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Избери Цвета' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Избери Анна' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Счупи лампата на Анна' }));
    await waitFor(() =>
      expect(sent(fake)[0]).toMatchObject({
        command: {
          type: 'PLAY_ACTION',
          cardId: 'c0',
          target: { kind: 'PLAYER', playerId: 'p-host' },
        },
      }),
    );
  });

  it('two-tool repair: only players with a matching broken tool, then the tool is chosen', async () => {
    const pub = withState({ players: brokenTools({ p3: { DRILL: 'BROKEN', LAMP: 'BROKEN' } }) });
    const fake = await openGame(undefined, { pub, mine: withHand('REPAIR_DRILL_LAMP') });
    fireEvent.click(hand().getByRole('button', { name: 'Поправи свредел или лампа' }));
    expect(screen.queryByRole('button', { name: 'Избери Анна' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Избери Цвета' })[0]!);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Кой инструмент да се поправи?' })).getByRole(
        'button',
        { name: 'Лампа' },
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Поправи лампата на Цвета' }));
    await waitFor(() =>
      expect(sent(fake)[0]).toMatchObject({
        command: { target: { kind: 'PLAYER', playerId: 'p3', tool: 'LAMP' } },
      }),
    );
  });

  it('survey: hidden destinations look identical; the result is shown privately to the actor', async () => {
    const fake = await openGame();
    const board = screen.getByRole('group', { name: 'Игрално поле' });
    expect(within(board).getByRole('img', { name: 'Неразкрита цел (цел 1)' })).toBeInTheDocument();
    expect(board.innerHTML).not.toMatch(/TREASURE|EMPTY|Злато|gold/i);

    fake.game.sendCommand.mockResolvedValueOnce({
      ok: true,
      commandType: 'PLAY_ACTION',
      version: 2,
      private: [{ kind: 'SCOUT_RESULT', playerId: 'p-me', slot: 1, identity: 'TREASURE' }],
    });
    fireEvent.click(hand().getByRole('button', { name: 'Разузнай цел' }));
    fireEvent.click(within(board).getByRole('button', { name: 'Избери цел 2 за разузнаване' }));
    fireEvent.click(screen.getByRole('button', { name: 'Погледни цел 2' }));
    const dialog = await screen.findByRole('dialog', { name: 'Тайно разузнаване' });
    expect(dialog).toHaveTextContent('Тук има злато.');
    expect(sent(fake)[0]).toMatchObject({ command: { target: { kind: 'DESTINATION', slot: 1 } } });
  });

  it('cave-in targets only placed tunnels (never the entrance or destinations)', async () => {
    const path = {
      cardId: 'b',
      typeId: 'PATH_STRAIGHT_EW' as const,
      rotation: 0 as const,
      x: 1,
      y: 0,
      placedBy: 'p-host',
      placedOnTurn: 1,
    };
    const pub = withState({
      board: { ...gameSnapshot().round.publicState.board, paths: { '1,0': path } },
    });
    const fake = await openGame(undefined, { pub, mine: withHand('COLLAPSE') });
    fireEvent.click(hand().getByRole('button', { name: 'Срути тунел' }));
    expect(
      screen
        .getAllByRole('button', { name: /^Срути тунела:/ })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Срути тунела: колона 1, ред 0']);
    fireEvent.click(screen.getByRole('button', { name: 'Срути тунела: колона 1, ред 0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Срути тунела' }));
    await waitFor(() =>
      expect(sent(fake)[0]).toMatchObject({ command: { target: { kind: 'CELL', x: 1, y: 0 } } }),
    );
  });

  it('discarding requires a second, explicit confirmation', async () => {
    const fake = await openGame();
    fireEvent.click(hand().getByRole('button', { name: 'Разузнай цел' }));
    fireEvent.click(screen.getByRole('button', { name: 'Изхвърли' }));
    expect(fake.game.sendCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Потвърди изхвърлянето' }));
    await waitFor(() =>
      expect(sent(fake)[0]).toMatchObject({ command: { type: 'DISCARD', cardId: 'c-scout' } }),
    );
  });

  it('explains why tunnels cannot be placed while a tool is broken', async () => {
    const pub = withState({ players: brokenTools({ 'p-me': { DRILL: 'BROKEN' } }) });
    await openGame(undefined, { pub });
    const card = hand().getByRole('button', { name: /^Тунел/ });
    expect(card).toHaveAccessibleName('Тунел — Блокиран');
    fireEvent.click(card);
    expect(
      screen.getByText('Не можеш да поставяш тунели, докато имаш счупен инструмент.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Постави тук/ })).not.toBeInTheDocument();
  });

  it('requests timeout resolution once after the server deadline and treats a lost race quietly', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fake = createFakeServices();
    fake.game.sendCommand.mockRejectedValue(new AppError('TURN_ALREADY_RESOLVED'));
    const pub = withState({
      activePlayerId: 'p-host',
      turnDeadline: Date.now() - 1_000,
      turnStartedAt: Date.now() - 61_000,
    });
    await openGame(fake, { pub });
    await waitFor(() => expect(fake.game.sendCommand).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    expect(sent(fake)[0]).toMatchObject({
      command: { type: 'RESOLVE_EXPIRED_TURN', expectedTurnNumber: 1 },
      expectedVersion: 1,
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1_000));
    expect(fake.game.sendCommand).toHaveBeenCalledTimes(1);
  });

  it('shows a dedicated refresh screen when the client is outdated', async () => {
    const fake = createFakeServices();
    fake.game.sendCommand.mockRejectedValue(new AppError('CLIENT_OUTDATED'));
    await openGame(fake);
    fireEvent.click(hand().getByRole('button', { name: 'Разузнай цел' }));
    fireEvent.click(screen.getByRole('button', { name: 'Изхвърли' }));
    fireEvent.click(screen.getByRole('button', { name: 'Потвърди изхвърлянето' }));
    const dialog = await screen.findByRole('dialog', { name: 'Има нова версия на играта' });
    expect(within(dialog).getByRole('button', { name: 'Презареди' })).toBeInTheDocument();
  });

  it('never shows mismatched public/private versions and recovers on the next notification', async () => {
    const fake = createFakeServices();
    fake.lobby.getSnapshot.mockResolvedValue(inGame());
    fake.game.getMyState.mockResolvedValue(myGameState({ version: 2 }));
    renderApp(`/r/${ROOM_CODE}`, fake.services);
    expect(await screen.findByText('Синхронизиране…')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Твоите карти' })).not.toBeInTheDocument();
    fake.game.getSnapshot.mockResolvedValue(gameSnapshot({ version: 2 }));
    act(() => fake.emitGameChanged(ROUND_ID, 2));
    expect(await screen.findByRole('list', { name: 'Твоите карти' })).toBeInTheDocument();
  });
});

describe('round results and final standings', () => {
  const ended = {
    phase: 'ROUND_ENDED' as const,
    resultsDeadline: Date.now() + 30_000,
    result: {
      winner: 'DISRUPTOR' as const,
      endReason: 'EXHAUSTED' as const,
      connectorPlayerId: null,
    },
    reveal: {
      roles: [
        { playerId: 'p-host', role: 'MINER' as const },
        { playerId: 'p-me', role: 'MINER' as const },
        { playerId: 'p3', role: 'DISRUPTOR' as const },
      ],
      setAsideRole: 'MINER' as const,
      destinations: ['EMPTY', 'TREASURE', 'EMPTY'] as const,
    },
  };

  it('shows the winner, revealed roles and points; non-hosts wait for the results deadline', async () => {
    const pub = {
      ...withState({ phase: 'ROUND_ENDED', activePlayerId: null, turnDeadline: null }, ended),
      scores: [
        { roundNo: 1, playerId: 'p3', points: 4, reason: 'DISRUPTORS_WON_SOLE' as const },
        { roundNo: 1, playerId: 'p-me', points: 0, reason: 'LOST' as const },
        { roundNo: 1, playerId: 'p-host', points: 0, reason: 'LOST' as const },
      ],
    };
    const fake = createFakeServices();
    fake.lobby.getSnapshot.mockResolvedValue(inGame());
    fake.game.getSnapshot.mockResolvedValue(pub);
    renderApp(`/r/${ROOM_CODE}`, fake.services);
    const dialog = await screen.findByRole('dialog', { name: 'Край на рунд 1' });
    expect(dialog).toHaveTextContent('Саботьорите успяха!');
    expect(dialog).toHaveTextContent('Цвета: Саботьор');
    expect(dialog).toHaveTextContent('Златото беше в цел 2.');
    expect(within(dialog).getByRole('row', { name: /Цвета/ })).toHaveTextContent('+4');
    expect(within(dialog).getByRole('button', { name: 'Започни рунд 2' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Виж полето' }));
    expect(screen.getByRole('button', { name: 'Резултати' })).toBeInTheDocument();
  });

  it('final leaderboard shares ranks and lets the host play again (server reset)', async () => {
    const base = withState(
      { phase: 'ROUND_ENDED', activePlayerId: null, turnDeadline: null },
      ended,
    );
    const pub: GameSnapshot = {
      ...base,
      game: { ...base.game, status: 'FINISHED', endReason: 'COMPLETED' },
      players: base.players.map((p) => ({ ...p, isHost: p.playerId === 'p-me' })),
      scores: [
        { roundNo: 1, playerId: 'p-host', points: 2, reason: 'MINERS_WON' },
        { roundNo: 1, playerId: 'p-me', points: 2, reason: 'MINERS_WON' },
        { roundNo: 1, playerId: 'p3', points: 0, reason: 'LOST' },
      ],
    };
    const fake = createFakeServices();
    fake.lobby.getSnapshot.mockResolvedValue(
      snapshot({ room: { ...snapshot().room, status: 'FINISHED' } }),
    );
    fake.game.getSnapshot.mockResolvedValue(pub);
    renderApp(`/r/${ROOM_CODE}`, fake.services);
    const dialog = await screen.findByRole('dialog', { name: 'Край на играта' });
    expect(dialog).toHaveTextContent('Победители: Анна, Борис');
    const rows = within(dialog).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent?.slice(0, 2))).toEqual(['1.', '1.', '3.']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Играй отново' }));
    await waitFor(() => expect(fake.lobby.resetRoom).toHaveBeenCalledWith(ROOM_ID));
  });
});
