import { DOMAIN_ERROR_CODES } from '../../domain/index.ts';

/**
 * Stable application-facing error codes. Server lobby RPCs return these codes in
 * `{ ok: false, error }`; transport failures are normalized here. UI maps codes to Bulgarian
 * text (src/i18n); raw Postgres/HTTP details never reach users.
 */
const SERVICE_ERROR_CODES = [
  'UNAUTHENTICATED',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_NOT_JOINABLE',
  'GAME_IN_PROGRESS',
  'NAME_TAKEN',
  'INVALID_NAME',
  'INVALID_CAPACITY',
  'INVALID_REQUEST',
  'INVALID_TARGET',
  'NOT_ROOM_MEMBER',
  'NOT_HOST',
  'NOT_IN_LOBBY',
  'HOST_CANNOT_READY',
  'CAPACITY_BELOW_PLAYERS',
  'TOO_MANY_ROOMS',
  'RATE_LIMITED',
  'STALE_STATE',
  'NETWORK_ERROR',
  'CONFIG_ERROR',
  'UNKNOWN',
  // Gameplay (game-command Edge Function)
  'CLIENT_OUTDATED',
  'COMMAND_ID_REUSED',
  'GAME_ALREADY_STARTED',
  'NOT_ENOUGH_PLAYERS',
  'PLAYERS_NOT_READY',
  'GAME_NOT_STARTED',
  'GAME_NOT_IN_PROGRESS',
  'ROUND_NOT_FINISHED',
  'RESULTS_NOT_EXPIRED',
  'INTERNAL',
  'GAME_NOT_FINISHED',
] as const;

/** Service codes plus every domain rule-violation code (returned verbatim by the server). */
export const APP_ERROR_CODES = [...SERVICE_ERROR_CODES, ...DOMAIN_ERROR_CODES] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = 'AppError';
    this.code = code;
  }
}

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && (APP_ERROR_CODES as readonly string[]).includes(value);
}

/** A code returned by a lobby RPC in `{ ok: false, error }`. Unknown codes become UNKNOWN. */
export function appErrorFromServerCode(code: unknown): AppError {
  return new AppError(isAppErrorCode(code) ? code : 'UNKNOWN');
}

const NETWORK_MESSAGE =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed/i;

/** Normalize anything thrown by supabase-js, fetch or our own code into an AppError. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (typeof error === 'object' && error !== null) {
    const e = error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown };
    const message = typeof e.message === 'string' ? e.message : '';
    if (
      e.name === 'AuthRetryableFetchError' ||
      e.name === 'FunctionsFetchError' ||
      e.name === 'FunctionsRelayError' ||
      NETWORK_MESSAGE.test(message)
    ) {
      return new AppError('NETWORK_ERROR', { cause: error });
    }
    // 42501: privilege missing (e.g. calling as `anon` without a session); PGRST301/303: JWT.
    if (e.code === '42501' || e.code === 'PGRST301' || e.code === 'PGRST303' || e.status === 401) {
      return new AppError('UNAUTHENTICATED', { cause: error });
    }
  }
  return new AppError('UNKNOWN', { cause: error });
}
