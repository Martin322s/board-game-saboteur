/**
 * Rules/state-shape version (ARCHITECTURE §3.3 "Version handshake").
 *
 * Increment whenever rules or the persisted RoundState shape change incompatibly.
 * The client will send it as the `x-rules-version` header; the authoritative Edge Function
 * rejects a mismatch with CLIENT_OUTDATED.
 */
export const RULES_VERSION = 2;
