import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/errors/appError.ts';
import { createFakeServices } from '../../test/fakes.tsx';
import { AuthProvider, useAuth } from './AuthProvider.tsx';

const probe = { ensure: (): Promise<string> => Promise.reject(new Error('not mounted')) };
const ensure = () => probe.ensure();

function Probe() {
  const { state, ensureSession } = useAuth();
  useEffect(() => {
    probe.ensure = ensureSession;
  }, [ensureSession]);
  return (
    <p data-testid="state">
      {state.status}
      {state.status === 'READY' ? `:${state.userId}` : ''}
      {state.status === 'ERROR' ? `:${state.error.code}` : ''}
    </p>
  );
}

function mount(gateway = createFakeServices().auth) {
  render(
    <AuthProvider gateway={gateway}>
      <Probe />
    </AuthProvider>,
  );
  return gateway;
}

const stateText = () => screen.getByTestId('state').textContent;

describe('anonymous auth bootstrap', () => {
  it('reuses a persisted session and never signs in again', async () => {
    const auth = mount();
    await waitFor(() => expect(stateText()).toBe('READY:user-1'));
    await act(() => ensure());
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('stays signed out until needed, then creates exactly one anonymous user', async () => {
    const auth = createFakeServices().auth;
    auth.getSession.mockResolvedValue(null);
    mount(auth);
    await waitFor(() => expect(stateText()).toBe('SIGNED_OUT'));
    expect(auth.signInAnonymously).not.toHaveBeenCalled();

    const ids = await act(() => Promise.all([ensure(), ensure()]));
    expect(ids).toEqual(['user-new', 'user-new']);
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(stateText()).toBe('READY:user-new');
  });

  it('does not replace a stored session when restoring fails (e.g. offline)', async () => {
    const auth = createFakeServices().auth;
    auth.getSession.mockRejectedValue(new AppError('NETWORK_ERROR'));
    mount(auth);
    await waitFor(() => expect(stateText()).toBe('ERROR:NETWORK_ERROR'));
    await act(() => ensure().catch(() => undefined));
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('recovers on retry after a failed anonymous sign-in', async () => {
    const auth = createFakeServices().auth;
    auth.getSession.mockResolvedValue(null);
    auth.signInAnonymously.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mount(auth);
    await waitFor(() => expect(stateText()).toBe('SIGNED_OUT'));
    await act(() => ensure().catch(() => undefined));
    expect(stateText()).toBe('ERROR:NETWORK_ERROR');
    await act(() => ensure());
    expect(stateText()).toBe('READY:user-new');
  });
});
