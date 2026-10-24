import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppError } from '../lib/errors/appError.ts';
import { createFakeServices, renderApp, ROOM_CODE } from '../test/fakes.tsx';

const createForm = () => screen.getByRole('form', { name: 'Създай стая' });
const joinForm = () => screen.getByRole('form', { name: 'Влез в стая' });
const type = (form: HTMLElement, label: string, value: string) =>
  fireEvent.change(within(form).getByLabelText(label), { target: { value } });

describe('landing: create room', () => {
  it('validates the name locally without calling the server', async () => {
    const fake = createFakeServices();
    renderApp('/', fake.services);
    type(createForm(), 'Вашето име', ' A ');
    fireEvent.click(within(createForm()).getByRole('button', { name: 'Създай стая' }));
    expect(await within(createForm()).findByRole('alert')).toHaveTextContent('2–20 символа');
    expect(fake.lobby.createRoom).not.toHaveBeenCalled();
  });

  it('ensures a session, creates the room and navigates to it', async () => {
    const fake = createFakeServices();
    fake.auth.getSession.mockResolvedValue(null);
    const { router } = renderApp('/', fake.services);
    type(createForm(), 'Вашето име', '  Мария  ');
    fireEvent.change(within(createForm()).getByLabelText('Брой места'), { target: { value: '8' } });
    fireEvent.click(within(createForm()).getByRole('button', { name: 'Създай стая' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/r/${ROOM_CODE}`));
    expect(fake.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(fake.lobby.createRoom).toHaveBeenCalledWith({ displayName: 'Мария', capacity: 8 });
  });

  it('shows server errors in Bulgarian', async () => {
    const fake = createFakeServices();
    fake.lobby.createRoom.mockRejectedValue(new AppError('RATE_LIMITED'));
    renderApp('/', fake.services);
    type(createForm(), 'Вашето име', 'Мария');
    fireEvent.click(within(createForm()).getByRole('button', { name: 'Създай стая' }));
    expect(await within(createForm()).findByRole('alert')).toHaveTextContent('Твърде много опити');
  });
});

describe('landing: join room', () => {
  it('normalizes the code, joins and navigates', async () => {
    const fake = createFakeServices();
    const { router } = renderApp('/', fake.services);
    type(joinForm(), 'Вашето име', 'Борис');
    type(joinForm(), 'Код на стаята', 'abc-234');
    fireEvent.click(within(joinForm()).getByRole('button', { name: 'Влез в стаята' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/r/${ROOM_CODE}`));
    expect(fake.lobby.joinRoom).toHaveBeenCalledWith({ code: 'ABC234', displayName: 'Борис' });
  });

  it.each([
    ['ROOM_FULL', 'Стаята е пълна.'],
    ['NAME_TAKEN', 'Това име вече се използва в стаята.'],
    ['ROOM_NOT_FOUND', 'Няма отворена стая с този код.'],
  ] as const)('maps %s', async (code, message) => {
    const fake = createFakeServices();
    fake.lobby.joinRoom.mockRejectedValue(new AppError(code));
    renderApp('/', fake.services);
    type(joinForm(), 'Вашето име', 'Борис');
    type(joinForm(), 'Код на стаята', 'ABC234');
    fireEvent.click(within(joinForm()).getByRole('button', { name: 'Влез в стаята' }));
    expect(await within(joinForm()).findByRole('alert')).toHaveTextContent(message);
  });

  it('rejects a malformed code before calling the server', async () => {
    const fake = createFakeServices();
    renderApp('/', fake.services);
    type(joinForm(), 'Вашето име', 'Борис');
    type(joinForm(), 'Код на стаята', 'OO1');
    fireEvent.click(within(joinForm()).getByRole('button', { name: 'Влез в стаята' }));
    expect(await within(joinForm()).findByRole('alert')).toHaveTextContent('Няма отворена стая');
    expect(fake.lobby.joinRoom).not.toHaveBeenCalled();
  });
});

describe('landing: reconnect discovery', () => {
  it('offers to continue in an active room for an existing session', async () => {
    const fake = createFakeServices();
    fake.lobby.getMyActiveRoom.mockResolvedValue({ roomId: 'r', code: 'XYZ789', status: 'LOBBY' });
    renderApp('/', fake.services);
    expect(await screen.findByRole('link', { name: 'Продължи в стаята' })).toHaveAttribute(
      'href',
      '/r/XYZ789',
    );
  });

  it('does not create an anonymous user just to check', async () => {
    const fake = createFakeServices();
    fake.auth.getSession.mockResolvedValue(null);
    renderApp('/', fake.services);
    await screen.findByRole('form', { name: 'Създай стая' });
    expect(fake.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(fake.lobby.getMyActiveRoom).not.toHaveBeenCalled();
  });
});
