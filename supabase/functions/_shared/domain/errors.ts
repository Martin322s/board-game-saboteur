/**
 * Stable, machine-readable error codes (PRODUCT_SPEC §6: the client maps codes to i18n keys).
 * Never put user-facing prose in the domain.
 */
export const DOMAIN_ERROR_CODES = [
  'INVALID_COMMAND',
  'INVALID_PLAYER_COUNT',
  'NOT_A_PLAYER',
  'PLAYER_LEFT',
  'ROUND_NOT_ACTIVE',
  'STALE_STATE',
  'NOT_YOUR_TURN',
  'CARD_NOT_IN_HAND',
  'WRONG_CARD_CATEGORY',
  'PLAYER_BLOCKED',
  'INVALID_ROTATION',
  'OUT_OF_BOUNDS',
  'CELL_OCCUPIED',
  'EDGE_MISMATCH',
  'NOT_CONNECTED',
  'INVALID_TARGET',
  'INVALID_TOOL',
  'TOOL_ALREADY_BROKEN',
  'TOOL_NOT_BROKEN',
  'DESTINATION_ALREADY_REVEALED',
  'INVALID_COLLAPSE_TARGET',
  'TURN_ALREADY_RESOLVED',
  'TURN_NOT_EXPIRED',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export interface DomainError {
  readonly code: DomainErrorCode;
  /** Set for TURN_NOT_EXPIRED so the client can reschedule. */
  readonly remainingMs?: number;
  /** Set for STALE_STATE so the client knows it must refetch. */
  readonly currentVersion?: number;
}

export function domainError(
  code: DomainErrorCode,
  extra: Omit<DomainError, 'code'> = {},
): DomainError {
  return { code, ...extra };
}
