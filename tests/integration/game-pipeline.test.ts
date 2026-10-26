import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activeUser,
  callAs,
  connect,
  createGameClient,
  DATABASE_URL,
  patchSecretState,
  privateSnapshot,
  publicSnapshot,
  secretState,
  setupRoom,
  type Room,
  type Sql,
} from './harness.ts';

/**
 * Prompt 3 targeted backend integration tests: persistence, authorization, secrecy, concurrency
 * and domain integration of the authoritative pipeline. (Rules themselves are covered by the
 * domain unit tests and are not re-tested here.)
 */
const suite = DATABASE_URL ? describe : describe.skip;

suite('authoritative game pipeline (real database)', () => {
  let sql: Sql;
  let client: ReturnType<typeof createGameClient>;

  beforeAll(() => {
    sql = connect();
    client = createGameClient(sql);
  });
  afterAll(async () => {
    await sql.end();
  });

  async function startedRoom(size = 3): Promise<Room> {
    const room = await setupRoom(sql, size);
    const started = await client.send(room.users[0]!, room.roomId, { type: 'START_GAME' });
    expect(started).toMatchObject({ ok: true, version: 1 });
    return room;
  }

  describe('START_GAME', () => {
    it('is host-only, starts exactly once under concurrency and is idempotent per command id', async () => {
      const room = await setupRoom(sql, 4);
      expect((await client.send(room.users[1]!, room.roomId, { type: 'START_GAME' })).error).toBe(
        'NOT_HOST',
      );

      const commandId = randomUUID();
      const [a, b] = await Promise.all([
        client.send(room.users[0]!, room.roomId, { type: 'START_GAME' }, { commandId }),
        client.send(room.users[0]!, room.roomId, { type: 'START_GAME' }),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect([a, b].find((r) => !r.ok)?.error).toBe('GAME_ALREADY_STARTED');

      const games =
        await sql`select count(*)::int as n from public.games where room_id = ${room.roomId}`;
      expect(games[0]!.n).toBe(1);
      if (a.ok) {
        const replay = await client.send(
          room.users[0]!,
          room.roomId,
          { type: 'START_GAME' },
          { commandId },
        );
        expect(replay).toMatchObject({
          ok: true,
          replayed: true,
          gameId: a.gameId,
          roundId: a.roundId,
        });
      }
    });

    it('deals a complete, secret round: exact card accounting, private roles and hands', async () => {
      const room = await startedRoom(4);
      const pub = (await publicSnapshot(sql, room.users[1]!, room.roomId)).snapshot;
      const state = pub.round.publicState;
      const handTotal = state.players.reduce(
        (s: number, p: { handCount: number }) => s + p.handCount,
        0,
      );
      expect(handTotal).toBe(4 * 6);
      expect(handTotal + state.drawPileCount).toBe(66);
      expect(pub.round).toMatchObject({
        roundNo: 1,
        phase: 'ROUND_ACTIVE',
        version: 1,
        reveal: null,
      });
      expect(state.board.destinations.map((d: { revealed: unknown }) => d.revealed)).toEqual([
        null,
        null,
        null,
      ]);

      const publicJson = JSON.stringify(pub);
      expect(publicJson).not.toMatch(/MINER|DISRUPTOR|TREASURE|"role"|setAside|drawPile"/);

      const secret = await secretState(sql, pub.round.id);
      const allHandIds = new Set<string>();
      for (const user of room.users) {
        const mine = (await privateSnapshot(sql, user, room.roomId)).private;
        expect(mine).toMatchObject({
          roundId: pub.round.id,
          version: 1,
          playerId: room.playerOf(user),
        });
        expect(['MINER', 'DISRUPTOR']).toContain(mine.state.role);
        expect(mine.state.hand.map((c: { handPosition: number }) => c.handPosition)).toEqual([
          0, 1, 2, 3, 4, 5,
        ]);
        for (const c of mine.state.hand) allHandIds.add(c.id);
        // A player's private state never contains another player's cards.
        const others = secret!.players.filter((p) => p.playerId !== room.playerOf(user));
        for (const other of others) {
          for (const card of other.hand.cards) expect(JSON.stringify(mine)).not.toContain(card.id);
        }
        expect(publicJson).not.toContain(mine.state.hand[0].id);
      }
      expect(allHandIds.size).toBe(24);
      for (const card of secret!.drawPile.slice(0, 5)) expect(publicJson).not.toContain(card.id);
    });

    it('rejects outdated clients and non-members', async () => {
      const room = await startedRoom();
      const stranger = randomUUID();
      await sql`insert into auth.users (id, aud, role) values (${stranger}, 'authenticated', 'authenticated')`;
      expect(
        (await client.send(room.users[0]!, room.roomId, { type: 'LEAVE' }, { rulesVersion: '0' }))
          .error,
      ).toBe('CLIENT_OUTDATED');
      expect((await client.send(stranger, room.roomId, { type: 'LEAVE' })).error).toBe(
        'NOT_ROOM_MEMBER',
      );
      expect((await publicSnapshot(sql, stranger, room.roomId)).error).toBe('NOT_ROOM_MEMBER');
      expect((await privateSnapshot(sql, stranger, room.roomId)).error).toBe('NOT_ROOM_MEMBER');
    });
  });

  describe('turn commands', () => {
    it('active player succeeds once; inactive, forged and stale requests are rejected; retries are idempotent', async () => {
      const room = await startedRoom();
      const turn = await activeUser(sql, room);
      const other = room.users.find((u) => u !== turn.userId)!;
      const myCard = (await privateSnapshot(sql, turn.userId, room.roomId)).private.state.hand[0]
        .id;
      const otherCard = (await privateSnapshot(sql, other, room.roomId)).private.state.hand[0].id;

      expect(
        (
          await client.send(
            other,
            room.roomId,
            { type: 'DISCARD', cardId: otherCard },
            { expectedVersion: 1 },
          )
        ).error,
      ).toBe('NOT_YOUR_TURN');
      expect(
        (
          await client.send(
            turn.userId,
            room.roomId,
            { type: 'DISCARD', cardId: otherCard },
            { expectedVersion: 1 },
          )
        ).error,
      ).toBe('CARD_NOT_IN_HAND');
      expect(
        (
          await client.send(
            turn.userId,
            room.roomId,
            { type: 'DISCARD', cardId: myCard },
            { expectedVersion: 0 },
          )
        ).error,
      ).toBe('STALE_STATE');

      const commandId = randomUUID();
      const command = { type: 'DISCARD', cardId: myCard };
      const first = await client.send(turn.userId, room.roomId, command, {
        expectedVersion: 1,
        commandId,
      });
      expect(first).toMatchObject({ ok: true, version: 2 });
      expect(first.private).toHaveLength(1); // the replacement draw, for the actor only

      const retry = await client.send(turn.userId, room.roomId, command, {
        expectedVersion: 1,
        commandId,
      });
      expect(retry).toMatchObject({ ok: true, version: 2, replayed: true });
      const reused = await client.send(turn.userId, room.roomId, { type: 'LEAVE' }, { commandId });
      expect(reused.error).toBe('COMMAND_ID_REUSED');

      const pub = (await publicSnapshot(sql, other, room.roomId)).snapshot.round;
      expect(pub.version).toBe(2);
      expect(pub.publicState.discardCount).toBe(1);
      expect(pub.publicState.activePlayerId).not.toBe(room.playerOf(turn.userId));
      const mine = (await privateSnapshot(sql, turn.userId, room.roomId)).private;
      expect(mine.version).toBe(2);
      expect(mine.state.hand.map((c: { id: string }) => c.id)).not.toContain(myCard);
      const log =
        await sql`select count(*)::int as n from private.command_log where command_id = ${commandId}`;
      expect(log[0]!.n).toBe(1);
    });

    it('survey: identity reaches only the actor, persists across refetch, and never becomes public', async () => {
      const room = await startedRoom();
      const turn = await activeUser(sql, room);
      const actorPlayer = room.playerOf(turn.userId);
      const secret = await patchSecretState(sql, turn.roundId, (s) => ({
        ...s,
        players: s.players.map((p) =>
          p.playerId === actorPlayer
            ? {
                ...p,
                hand: {
                  cards: [
                    ...p.hand.cards,
                    { id: 'scout-x', typeId: 'SCOUT', handPosition: p.hand.nextHandPosition },
                  ],
                  nextHandPosition: p.hand.nextHandPosition + 1,
                },
              }
            : p,
        ),
      }));
      const identity = secret.destinationIdentities[2];

      const res = await client.send(
        turn.userId,
        room.roomId,
        { type: 'PLAY_ACTION', cardId: 'scout-x', target: { kind: 'DESTINATION', slot: 2 } },
        { expectedVersion: turn.version },
      );
      expect(res.ok).toBe(true);
      expect(res.private).toContainEqual({
        kind: 'SCOUT_RESULT',
        playerId: actorPlayer,
        slot: 2,
        identity,
      });

      const mine = (await privateSnapshot(sql, turn.userId, room.roomId)).private.state;
      expect(mine.knownDestinations).toEqual([{ slot: 2, identity }]);
      for (const user of room.users.filter((u) => u !== turn.userId)) {
        expect(
          (await privateSnapshot(sql, user, room.roomId)).private.state.knownDestinations,
        ).toEqual([]);
      }
      const pub = (await publicSnapshot(sql, room.users[0]!, room.roomId)).snapshot;
      expect(pub.round.publicState.board.destinations[2].revealed).toBeNull();
      expect(pub.events.at(-1)).toMatchObject({ type: 'DESTINATION_SCOUTED', slot: 2 });
      expect(JSON.stringify(pub.events)).not.toMatch(/TREASURE|EMPTY/);
    });
  });

  describe('RESOLVE_EXPIRED_TURN', () => {
    it('is rejected before the server deadline and resolved exactly once by racing members after it', async () => {
      const room = await startedRoom();
      const turn = await activeUser(sql, room);
      const resolve = (user: string) =>
        client.send(
          user,
          room.roomId,
          { type: 'RESOLVE_EXPIRED_TURN', expectedTurnNumber: turn.turnNumber },
          { expectedVersion: turn.version },
        );

      expect(await resolve(room.users[1]!)).toMatchObject({ ok: false, error: 'TURN_NOT_EXPIRED' });

      const before = await patchSecretState(sql, turn.roundId, (s) => ({ ...s, turnDeadline: 0 }));
      const timedOut = before.players.find((p) => p.playerId === before.activePlayerId)!;
      const lowest = [...timedOut.hand.cards].sort((a, b) => a.handPosition - b.handPosition)[0]!;

      const results = await Promise.all(room.users.map((u) => resolve(u)));
      const winners = results.filter((r) => r.ok);
      expect(winners).toHaveLength(1);
      for (const loser of results.filter((r) => !r.ok)) {
        expect(['TURN_ALREADY_RESOLVED', 'STALE_STATE']).toContain(loser.error);
      }

      const after = await secretState(sql, turn.roundId);
      expect(after!.version).toBe(turn.version + 1);
      expect(after!.turnNumber).toBe(turn.turnNumber + 1);
      expect(after!.discardPile).toEqual([
        { card: { id: lowest.id, typeId: lowest.typeId }, faceUp: false },
      ]);
      expect(after!.drawPile).toHaveLength(before.drawPile.length - 1);
      const timedOutAfter = after!.players.find((p) => p.playerId === timedOut.playerId)!;
      expect(timedOutAfter.hand.cards).toHaveLength(timedOut.hand.cards.length);
      expect(timedOutAfter.consecutiveTimeouts).toBe(1);
      const events =
        await sql`select event from public.round_events where round_id = ${turn.roundId} and event->>'type' = 'TURN_TIMED_OUT'`;
      expect(events).toHaveLength(1);
    });
  });

  describe('round end, results and next round', () => {
    it('persists the result, reveals roles only after the end, keeps scores and starts round 2', async () => {
      const room = await startedRoom();
      const turn = await activeUser(sql, room);
      const activeId = room.playerOf(turn.userId);
      expect(
        (await publicSnapshot(sql, room.users[0]!, room.roomId)).snapshot.round.reveal,
      ).toBeNull();

      // Fixture: last card in the game is in the active player's hand → exhaustion on discard.
      await patchSecretState(sql, turn.roundId, (s) => ({
        ...s,
        drawPile: [],
        players: s.players.map((p) => ({
          ...p,
          hand:
            p.playerId === activeId
              ? { ...p.hand, cards: p.hand.cards.slice(0, 1) }
              : { ...p.hand, cards: [] },
        })),
      }));
      const last = (await secretState(sql, turn.roundId))!.players.find(
        (p) => p.playerId === activeId,
      )!.hand.cards[0]!;
      const ended = await client.send(
        turn.userId,
        room.roomId,
        { type: 'DISCARD', cardId: last.id },
        { expectedVersion: turn.version },
      );
      expect(ended.ok).toBe(true);

      const pub = (await publicSnapshot(sql, room.users[1]!, room.roomId)).snapshot;
      expect(pub.round).toMatchObject({
        phase: 'ROUND_ENDED',
        result: { winner: 'DISRUPTOR', endReason: 'EXHAUSTED' },
      });
      expect(pub.round.reveal.roles).toHaveLength(3);
      expect(pub.round.reveal.destinations).toHaveLength(3);
      expect(pub.scores).toHaveLength(3);
      expect(await secretState(sql, turn.roundId)).toBeNull(); // secrets dropped at round end

      expect(
        (
          await client.send(
            turn.userId,
            room.roomId,
            { type: 'DISCARD', cardId: 'x' },
            { expectedVersion: 2 },
          )
        ).error,
      ).toBe('ROUND_NOT_ACTIVE');
      expect(
        (await client.send(room.users[1]!, room.roomId, { type: 'START_NEXT_ROUND' })).error,
      ).toBe('RESULTS_NOT_EXPIRED');

      const next = await client.send(room.users[0]!, room.roomId, { type: 'START_NEXT_ROUND' });
      expect(next).toMatchObject({ ok: true, version: 1 });
      const round2 = (await publicSnapshot(sql, room.users[1]!, room.roomId)).snapshot;
      expect(round2.game).toMatchObject({ status: 'IN_PROGRESS', currentRoundNo: 2 });
      expect(round2.round).toMatchObject({ roundNo: 2, phase: 'ROUND_ACTIVE', reveal: null });
      expect(round2.scores).toHaveLength(3); // round 1 scores retained
      expect(round2.round.publicState.board.paths).toEqual({});
      const mine = (await privateSnapshot(sql, room.users[1]!, room.roomId)).private;
      expect(mine).toMatchObject({ roundNo: 2, version: 1 });
      expect(mine.state.knownDestinations).toEqual([]);
    });
  });

  describe('LEAVE during a game', () => {
    it('advances the turn, never reveals roles, and ends the game when too few players remain', async () => {
      const room = await startedRoom();
      const turn = await activeUser(sql, room);
      const left = await client.send(turn.userId, room.roomId, { type: 'LEAVE' });
      expect(left.ok).toBe(true);

      const remaining = room.users.filter((u) => u !== turn.userId);
      const pub = (await publicSnapshot(sql, remaining[0]!, room.roomId)).snapshot;
      expect(pub.round.publicState.activePlayerId).not.toBe(room.playerOf(turn.userId));
      expect(pub.round.reveal).toBeNull();
      expect(JSON.stringify(pub)).not.toMatch(/MINER|DISRUPTOR/);
      expect(
        pub.players.find((p: { playerId: string }) => p.playerId === room.playerOf(turn.userId))
          .status,
      ).toBe('LEFT');
      expect((await publicSnapshot(sql, turn.userId, room.roomId)).error).toBe('NOT_ROOM_MEMBER');

      // A second departure leaves one player: the round ends without a winner and the game ends.
      const second = await client.send(remaining[0]!, room.roomId, { type: 'LEAVE' });
      expect(second.ok).toBe(true);
      const final = (await publicSnapshot(sql, remaining[1]!, room.roomId)).snapshot;
      expect(final.game).toMatchObject({ status: 'FINISHED', endReason: 'INSUFFICIENT_PLAYERS' });
      expect(final.round.result).toMatchObject({
        winner: 'NONE',
        endReason: 'INSUFFICIENT_PLAYERS',
      });
      const roomRow = await callAs(sql, remaining[1]!, 'get_room_snapshot', room.code);
      expect(roomRow.snapshot.room.status).toBe('FINISHED');
    });
  });
});
