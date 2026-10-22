import { describe, expect, it } from 'vitest';
import { readPublicEnv } from '../env.ts';
import { AppError, appErrorFromServerCode, toAppError } from './appError.ts';

describe('error normalization', () => {
  it('maps known server codes and hides unknown ones', () => {
    expect(appErrorFromServerCode('ROOM_FULL').code).toBe('ROOM_FULL');
    expect(appErrorFromServerCode('SOMETHING_NEW').code).toBe('UNKNOWN');
    expect(appErrorFromServerCode(undefined).code).toBe('UNKNOWN');
  });

  it.each([
    [new TypeError('Failed to fetch'), 'NETWORK_ERROR'],
    [{ name: 'AuthRetryableFetchError', message: '' }, 'NETWORK_ERROR'],
    [{ message: 'TypeError: Load failed', code: '' }, 'NETWORK_ERROR'],
    [{ code: '42501', message: 'permission denied for function create_room' }, 'UNAUTHENTICATED'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 'UNAUTHENTICATED'],
    [{ code: '23505', message: 'duplicate key value violates unique constraint' }, 'UNKNOWN'],
    ['boom', 'UNKNOWN'],
  ])('%o → %s', (input, code) => {
    expect(toAppError(input).code).toBe(code);
  });

  it('passes AppErrors through and never exposes raw messages as the code', () => {
    const original = new AppError('NOT_HOST');
    expect(toAppError(original)).toBe(original);
    expect(toAppError({ message: 'relation "rooms" does not exist' }).code).toBe('UNKNOWN');
  });
});

describe('public env', () => {
  it('requires a URL and a publishable key', () => {
    expect(readPublicEnv({})).toEqual({
      ok: false,
      missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'],
    });
    expect(
      readPublicEnv({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' }),
    ).toEqual({
      ok: false,
      missing: ['VITE_SUPABASE_URL'],
    });
    expect(
      readPublicEnv({
        VITE_SUPABASE_URL: ' http://127.0.0.1:54321 ',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'pk',
      }),
    ).toEqual({
      ok: true,
      value: { supabaseUrl: 'http://127.0.0.1:54321', supabasePublishableKey: 'pk' },
    });
  });
});
