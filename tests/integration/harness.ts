import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { handleGameCommand } from '../../supabase/functions/_shared/game/handler.ts';
import { createRpcGameStore, type RpcCaller } from '../../supabase/functions/_shared/game/store.ts';
import { RULES_VERSION, type RoundState } from '../../supabase/functions/_shared/domain/index.ts';

/**
 * Drives the REAL authoritative pipeline (handler + store + SQL) against a migrated database:
 *  - trusted calls run as `service_role` (exactly what the Edge Function's key can do),
 *  - client reads run as `authenticated` with the player's JWT claims,
 *  - only test setup/inspection runs as `postgres`.
 */
export const DATABASE_URL = process.env.DATABASE_URL;

export type Sql = postgres.Sql;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function connect(): Sql {
  return postgres(DATABASE_URL as string, { max: 12, onnotice: () => undefined });
}

export function serviceRpc(sql: Sql): RpcCaller {
  return (fn, payload) =>
    sql.begin(async (tx) => {
      await tx`set local role service_role`;
      const rows = await tx.unsafe(`select public.${fn}($1::jsonb) as r`, [
        tx.json(payload as never),
      ]);
      return rows[0]?.r;
    });
}

/** Call a public RPC as an authenticated player. */
export async function callAs(
  sql: Sql,
  userId: string,
  fn: string,
  ...args: unknown[]
): Promise<Json> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
    await tx`set local role authenticated`;
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await tx.unsafe(`select public.${fn}(${placeholders}) as r`, args as never[]);
    return rows[0]?.r as Json;
  });
}

let seedCounter = 0;

export function createGameClient(sql: Sql) {
  const deps = {
    store: createRpcGameStore(serviceRpc(sql)),
    generateSeed: () => `it-seed-${++seedCounter}`,
  };
  return {
    /** Send a command as `userId` (identity already "verified"). Returns the response body. */
    async send(
      userId: string,
      roomId: string,
      command: Json,
      options: { expectedVersion?: number; commandId?: string; rulesVersion?: string } = {},
    ): Promise<Json> {
      const result = await handleGameCommand(
        {
          userId,
          rulesVersion: options.rulesVersion ?? String(RULES_VERSION),
          body: {
            roomId,
            commandId: options.commandId ?? randomUUID(),
            command,
            ...(options.expectedVersion === undefined
              ? {}
              : { expectedVersion: options.expectedVersion }),
          },
        },
        deps,
      );
      return result.body as Json;
    },
  };
}

export interface Room {
  readonly roomId: string;
  readonly code: string;
  readonly users: readonly string[];
  /** room_players.id (domain PlayerId) → auth user id */
  userOf(playerId: string): string;
  playerOf(userId: string): string;
}

/** Create users, a room (host = users[0]) and ready all non-hosts. */
export async function setupRoom(sql: Sql, size = 3): Promise<Room> {
  const users = Array.from({ length: size }, () => randomUUID());
  for (const id of users) {
    await sql`insert into auth.users (id, aud, role, is_anonymous) values (${id}, 'authenticated', 'authenticated', true)`;
  }
  const created = await callAs(sql, users[0]!, 'create_room', 'Домакин', Math.max(size, 3));
  if (!created.ok) throw new Error(`create_room: ${created.error}`);
  for (const [i, user] of users.entries()) {
    if (i === 0) continue;
    const joined = await callAs(sql, user, 'join_room', created.code, `Играч ${i}`);
    if (!joined.ok) throw new Error(`join_room: ${joined.error}`);
    const ready = await callAs(sql, user, 'set_ready', created.roomId, true);
    if (!ready.ok) throw new Error(`set_ready: ${ready.error}`);
  }
  const rows = await sql<{ id: string; user_id: string }[]>`
    select id, user_id from public.room_players where room_id = ${created.roomId} and status = 'ACTIVE'`;
  const byPlayer = new Map(rows.map((r) => [r.id, r.user_id]));
  const byUser = new Map(rows.map((r) => [r.user_id, r.id]));
  return {
    roomId: created.roomId,
    code: created.code,
    users,
    userOf: (playerId) => byPlayer.get(playerId) as string,
    playerOf: (userId) => byUser.get(userId) as string,
  };
}

export const publicSnapshot = async (sql: Sql, userId: string, roomId: string) =>
  callAs(sql, userId, 'get_game_snapshot', roomId);

export const privateSnapshot = async (sql: Sql, userId: string, roomId: string) =>
  callAs(sql, userId, 'get_my_game_state', roomId);

export async function secretState(sql: Sql, roundId: string): Promise<RoundState | null> {
  const rows = await sql<{ state: RoundState }[]>`
    select state from private.round_secrets where round_id = ${roundId}`;
  return rows[0]?.state ?? null;
}

/** Test-only fixture control: rewrite the authoritative secret state of a round. */
export async function patchSecretState(
  sql: Sql,
  roundId: string,
  patch: (state: RoundState) => RoundState,
): Promise<RoundState> {
  const current = await secretState(sql, roundId);
  if (!current) throw new Error('no secret state');
  const next = patch(current);
  await sql`update private.round_secrets set state = ${sql.json(next as never)} where round_id = ${roundId}`;
  return next;
}

/** The user whose turn it is, from the public snapshot. */
export async function activeUser(
  sql: Sql,
  room: Room,
): Promise<{ userId: string; version: number; turnNumber: number; roundId: string }> {
  const snap = await publicSnapshot(sql, room.users[0]!, room.roomId);
  const round = snap.snapshot.round;
  return {
    userId: room.userOf(round.publicState.activePlayerId),
    version: round.version,
    turnNumber: round.publicState.turnNumber,
    roundId: round.id,
  };
}
