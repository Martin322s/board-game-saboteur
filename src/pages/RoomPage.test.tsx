import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppError } from '../lib/errors/appError.ts';
import {
  createFakeServices,
  player,
  renderApp,
  ROOM_CODE,
  ROOM_ID,
  snapshot,
} from '../test/fakes.tsx';

const openLobby = async (fake = createFakeServices()) => {
  const view = renderApp(`/r/${ROOM_CODE.toLowerCase()}`, fake.services);
  await screen.findByRole('heading', { name: `Стая ${ROOM_CODE}` });
  return { ...view, fake };
};

describe('lobby', () => {
  it('renders code, capacity, players, host, ready and connection state', async () => {
    const fake = createFakeServices();
    fake.lobby.getSnapshot.mockResolvedValue(
      snapshot({
        players: [
          player(),
          player({
            playerId: 'p-me',
            seat: 1,
            displayName: 'Борис',
            isHost: false,
            isMe: true,
            isReady: true,
          }),
          player({
            playerId: 'p3',
            seat: 2,
            displayName: '<b>Цвета</b>',
            isHost: false,
            connection: 'AWAY',
          }),
        ],
      }),
    );
    await openLobby(fake);

    expect(fake.lobby.getSnapshot).toHaveBeenCalledWith(ROOM_CODE);
    expect(screen.getByText('3 / 6 играчи')).toBeInTheDocument();
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Анна');
    expect(rows[0]).toHaveTextContent('Домакин');
    expect(rows[1]).toHaveTextContent('Борис(вие)');
    expect(rows[1]).toHaveTextContent('Готов');
    // Names are text, never markup.
    expect(rows[2]).toHaveTextContent('<b>Цвета</b>');
    expect(rows[2]).toHaveTextContent('Отсъства');
    expect(screen.getByText('Изчакваме още 1 играч да е готов.')).toBeInTheDocument();
  });

  it('toggles only my ready state through the server and shows the result', async () => {
    const fake = createFakeServices();
    fake.lobby.setReady.mockResolvedValue(
      snapshot({
        room: { ...snapshot().room, version: 2 },
        players: [
          player(),
          player({
            playerId: 'p-me',
            seat: 1,
            displayName: 'Борис',
            isHost: false,
            isMe: true,
            isReady: true,
          }),
        ],
      }),
    );
    await openLobby(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Готов съм' }));
    expect(await screen.findByRole('button', { name: 'Още не съм готов' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(fake.lobby.setReady).toHaveBeenCalledWith(ROOM_ID, true);
  });

  it('host sees a disabled start control (gameplay is not part of this iteration)', async () => {
    const fake = createFakeServices();
    fake.lobby.getSnapshot.mockResolvedValue(
      snapshot({
        players: [
          player({ isMe: true }),
          player({ playerId: 'p2', seat: 1, isHost: false, displayName: 'Борис' }),
        ],
      }),
    );
    await openLobby(fake);
    expect(screen.getByRole('button', { name: 'Започни играта' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Готов съм' })).not.toBeInTheDocument();
  });

  it('refetches the snapshot only for newer realtime notifications', async () => {
    const { fake } = await openLobby();
    await waitFor(() =>
      expect(fake.realtime.subscribeToRoom).toHaveBeenCalledWith(ROOM_ID, expect.anything()),
    );
    const before = fake.lobby.getSnapshot.mock.calls.length;

    act(() => fake.emitRoomChanged(1)); // duplicate/old version: ignored
    expect(fake.lobby.getSnapshot).toHaveBeenCalledTimes(before);

    fake.lobby.getSnapshot.mockResolvedValue(
      snapshot({
        room: { ...snapshot().room, version: 2 },
        players: [
          player(),
          player({ playerId: 'p-me', seat: 1, displayName: 'Борис', isHost: false, isMe: true }),
          player({ playerId: 'p3', seat: 2, displayName: 'Цвета', isHost: false }),
        ],
      }),
    );
    act(() => fake.emitRoomChanged(2));
    expect(await screen.findByText('Цвета')).toBeInTheDocument();
    expect(fake.lobby.getSnapshot).toHaveBeenCalledTimes(before + 1);
  });

  it('shows a reconnect banner and refetches after resubscribing', async () => {
    const { fake } = await openLobby();
    await waitFor(() => expect(fake.realtime.subscribeToRoom).toHaveBeenCalled());
    act(() => fake.emitStatus('DISCONNECTED'));
    expect(screen.getByText(/Връзката е прекъсната/)).toBeInTheDocument();

    const before = fake.lobby.getSnapshot.mock.calls.length;
    act(() => fake.emitStatus('SUBSCRIBED'));
    await waitFor(() => expect(fake.lobby.getSnapshot.mock.calls.length).toBeGreaterThan(before));
    expect(screen.queryByText(/Връзката е прекъсната/)).not.toBeInTheDocument();
  });

  it('sends a heartbeat as soon as the lobby is open', async () => {
    const { fake } = await openLobby();
    await waitFor(() => expect(fake.lobby.heartbeat).toHaveBeenCalledWith(ROOM_ID));
  });
});

describe('room route membership', () => {
  it('offers to join when the visitor is not a member, then shows the lobby', async () => {
    const fake = createFakeServices();
    fake.lobby.getSnapshot.mockRejectedValueOnce(new AppError('NOT_ROOM_MEMBER'));
    renderApp(`/r/${ROOM_CODE}`, fake.services);

    const form = await screen.findByRole('form', { name: 'Не сте в тази стая' });
    expect(within(form).queryByLabelText('Код на стаята')).not.toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('Вашето име'), { target: { value: 'Борис' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Влез в стаята' }));

    expect(await screen.findByRole('heading', { name: `Стая ${ROOM_CODE}` })).toBeInTheDocument();
    expect(fake.lobby.joinRoom).toHaveBeenCalledWith({ code: ROOM_CODE, displayName: 'Борис' });
  });

  it('signs in anonymously on a fresh browser before loading the room', async () => {
    const fake = createFakeServices();
    fake.auth.getSession.mockResolvedValue(null);
    await openLobby(fake);
    expect(fake.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('leaving returns to the landing page', async () => {
    const { fake, router } = await openLobby();
    fireEvent.click(screen.getByRole('button', { name: 'Напусни стаята' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, напусни' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(fake.lobby.leaveRoom).toHaveBeenCalledWith(ROOM_ID);
  });
});
