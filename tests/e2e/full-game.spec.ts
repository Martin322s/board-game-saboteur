/**
 * COMPLETE local multiplayer game through the real UI and the real local stack:
 * Vite → local Auth → PostgREST → Postgres → Realtime → game-command (Edge Runtime).
 *
 * Three isolated browser contexts = three anonymous identities. The local database is read
 * (never written) only to choose moves, verify outcomes and build the privacy oracle.
 *
 *   npm run local:start   (other terminal)     npm run dev   (other terminal)
 *   npx playwright test tests/e2e/full-game.spec.ts
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import postgres from 'postgres';

const DB_URL = process.env.LOCAL_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:55322/postgres';
const NAMES = ['Анна', 'Борис', 'Цвета'] as const;
const TOOL_DEF: Record<string, string> = { DRILL: 'свредела', LAMP: 'лампата', ROPE: 'въжето' };
const TOOL_NOM: Record<string, string> = { DRILL: 'Свредел', LAMP: 'Лампа', ROPE: 'Въже' };
const CARD_ID = /^c[a-z2-7]{10}$/;
const PRIVATE_SURVEY_LABEL =
  'Само ти виждаш това. Остава записано под картите ти до края на рунда.';
const ALLOWED_BROADCAST_KEYS = new Set(['roomVersion', 'gameId', 'roundId', 'version']);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Player {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  userId: string;
  playerId: string;
  readonly payloads: { url: string; body: unknown }[];
  readonly frames: string[];
  readonly handsEver: Set<string>;
}

test.setTimeout(40 * 60_000);

test('complete 3-round local game: lobby, every action, privacy, realtime, refresh, timeout, results, play again', async ({
  browser,
}) => {
  const sql = postgres(DB_URL, { max: 3, onnotice: () => undefined });
  const players: Player[] = [];
  const placedEver = new Set<string>();
  const log = (msg: string) => console.log(`[e2e] ${msg}`);

  try {
    // ---------------------------------------------------------------- setup: 3 identities
    for (const name of NAMES) {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await context.newPage();
      const p: Player = {
        name,
        context,
        page,
        userId: '',
        playerId: '',
        payloads: [],
        frames: [],
        handsEver: new Set(),
      };
      page.on('response', async (res) => {
        const url = res.url();
        if (res.request().method() === 'OPTIONS') return;
        if (!url.includes('/rest/v1/rpc/') && !url.includes('/functions/v1/')) return;
        try {
          p.payloads.push({ url, body: await res.json() });
        } catch {
          /* non-JSON */
        }
      });
      page.on('websocket', (ws) =>
        ws.on('framereceived', (f) =>
          p.frames.push(typeof f.payload === 'string' ? f.payload : f.payload.toString()),
        ),
      );
      page.on('request', (req) => {
        if (req.url().includes('supabase.co'))
          throw new Error('hosted Supabase must not be used locally');
      });
      players.push(p);
    }
    const [A, B, C] = players as [Player, Player, Player];
    const userIdOf = (p: Player) =>
      p.page.evaluate(
        () => JSON.parse(localStorage.getItem('tunnels.auth') ?? '{}')?.user?.id as string,
      );
    const byPlayerId = (id: string | null) => players.find((p) => p.playerId === id);

    // ---------------------------------------------------------------- lobby
    await A.page.goto('/');
    const create = A.page
      .locator('form')
      .filter({ has: A.page.getByRole('button', { name: 'Създай стая', exact: true }) });
    await create.getByLabel('Вашето име', { exact: true }).fill(A.name);
    await create.getByRole('combobox').selectOption('3');
    await create.getByRole('button', { name: 'Създай стая', exact: true }).click();
    await expect(A.page).toHaveURL(/\/r\/[A-Z0-9]{6}$/);
    const roomUrl = A.page.url();
    const code = roomUrl.slice(-6);
    log(`room ${code} created`);

    for (const p of [B, C]) {
      await p.page.goto(roomUrl);
      await p.page.getByLabel('Вашето име', { exact: true }).fill(p.name);
      await p.page.getByRole('button', { name: 'Влез в стаята', exact: true }).click();
      await expect(p.page.getByRole('heading', { name: `Стая ${code}` })).toBeVisible();
    }
    for (const p of players) p.userId = await userIdOf(p);
    expect(new Set(players.map((p) => p.userId)).size).toBe(3); // three distinct anonymous identities

    const [room] =
      await sql`select id, host_player_id from public.rooms where code = ${code} and status <> 'CLOSED'`;
    const members =
      await sql`select id, user_id, seat, display_name from public.room_players where room_id = ${room!.id} and status = 'ACTIVE' order by seat`;
    expect(members.map((m) => m.display_name)).toEqual([...NAMES]);
    for (const p of players) p.playerId = members.find((m) => m.user_id === p.userId)!.id;
    expect(room!.host_player_id).toBe(A.playerId);
    for (const p of players) {
      for (const name of NAMES)
        await expect(
          p.page.getByRole('list').getByText(name, { exact: false }).first(),
        ).toBeVisible();
    }

    // Ready B and C; every client sees it through Realtime.
    for (const p of [B, C])
      await p.page.getByRole('button', { name: 'Готов съм', exact: true }).click();
    await expect(A.page.getByRole('button', { name: 'Започни играта', exact: true })).toBeEnabled({
      timeout: 10_000,
    });

    // Refresh B: same identity, membership and seat.
    const seatBefore = members.find((m) => m.user_id === B.userId)!.seat;
    await B.page.reload();
    await expect(B.page.getByRole('heading', { name: `Стая ${code}` })).toBeVisible();
    expect(await userIdOf(B)).toBe(B.userId);
    const [bAfter] =
      await sql`select seat, status from public.room_players where id = ${B.playerId}`;
    expect(bAfter).toMatchObject({ seat: seatBefore, status: 'ACTIVE' });
    log('lobby: 3 identities, host, ready sync and refresh recovery OK');

    // ---------------------------------------------------------------- helpers
    const current = async () => {
      const [r] = await sql`
        select r.id, r.round_no, r.phase, r.state_version as version, r.active_player_id, r.turn_number,
               r.public_state, r.winner, r.end_reason, g.id as game_id, g.status as game_status
        from public.rounds r join public.games g on g.id = r.game_id
        where g.room_id = ${room!.id} order by g.created_at desc, r.round_no desc limit 1`;
      return r as Json;
    };
    const secret = async (roundId: string) =>
      ((await sql`select state from private.round_secrets where round_id = ${roundId}`)[0]?.state ??
        null) as Json | null;
    const track = async () => {
      const r = await current();
      for (const path of Object.values(r.public_state.board.paths) as Json[])
        placedEver.add(path.cardId);
      const s = await secret(r.id);
      if (s)
        for (const sp of s.players)
          for (const c of sp.hand.cards) byPlayerId(sp.playerId)?.handsEver.add(c.id);
      // Secrets are deleted at round end; per-player private rows keep the final hands.
      for (const row of await sql`select player_id, private_state from public.round_player_private where round_id = ${r.id}`) {
        for (const c of (row.private_state as Json).hand)
          byPlayerId(row.player_id)?.handsEver.add(c.id);
      }
      return { r, s };
    };
    const waitVersion = async (roundId: string, above: number) =>
      expect
        .poll(
          async () => {
            const r = await current();
            return r.id !== roundId || r.version > above;
          },
          { timeout: 20_000 },
        )
        .toBe(true);
    const hand = (p: Player) => p.page.getByRole('list', { name: 'Твоите карти' });
    const sendCommand = async (p: Player, act: () => Promise<void>) => {
      const res = p.page.waitForResponse(
        (r) => r.url().includes('/functions/v1/game-command') && r.request().method() === 'POST',
        { timeout: 20_000 },
      );
      await act();
      const body = (await (await res).json()) as Json;
      expect(body, `${p.name} command`).toMatchObject({ ok: true });
      return body;
    };
    const legalCells = async (p: Player) => {
      const labels = await p.page
        .getByRole('button', { name: /^Постави тук/ })
        .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
      return labels.map((l) => {
        const m = /колона (-?\d+), ред (-?\d+)/.exec(l)!;
        return { x: Number(m[1]), y: Number(m[2]) };
      });
    };
    const dismissRoleReveal = async (s: Json) => {
      for (const p of players) {
        const dialog = p.page.getByRole('dialog', { name: /^Рунд \d от 3$/ });
        await expect(dialog).toBeVisible({ timeout: 15_000 });
        await dialog.getByRole('button', { name: 'Виж ролята си' }).click();
        const role = s.players.find((sp: Json) => sp.playerId === p.playerId).role;
        await expect(dialog).toContainText(role === 'MINER' ? 'Ти си джудже' : 'Ти си саботьор');
        await dialog.getByRole('button', { name: 'Готов съм' }).click();
        await expect(hand(p)).toBeVisible();
      }
    };

    // ---------------------------------------------------------------- privacy oracle
    const assertPrivacy = () => {
      for (const p of players) {
        for (const { url, body } of p.payloads) {
          const where = `${p.name} ← ${url.split('/').slice(-1)[0]}`;
          const ownPrivate = url.includes('get_my_game_state');
          const visit = (node: unknown, path: string[]) => {
            if (Array.isArray(node)) return node.forEach((v, i) => visit(v, [...path, String(i)]));
            if (!node || typeof node !== 'object') return;
            const obj = node as Json;
            for (const [k, v] of Object.entries(obj)) {
              if (['destinationIdentities', 'drawPile', 'seed', 'discardPile'].includes(k))
                throw new Error(`LEAK ${where}: ${k}`);
              if (
                (k === 'id' || k === 'cardId') &&
                typeof v === 'string' &&
                CARD_ID.test(v) &&
                !p.handsEver.has(v) &&
                !placedEver.has(v)
              ) {
                throw new Error(`LEAK ${where}: foreign card id at ${path.join('.')}`);
              }
              if (k === 'setAsideRole' && !path.includes('reveal'))
                throw new Error(`LEAK ${where}: setAsideRole`);
              if (
                k === 'role' &&
                !path.includes('reveal') &&
                !(ownPrivate && path.join('.') === 'private.state')
              ) {
                throw new Error(`LEAK ${where}: role at ${path.join('.')}`);
              }
              if (k === 'knownDestinations' && !ownPrivate)
                throw new Error(`LEAK ${where}: knownDestinations`);
              if (
                k === 'kind' &&
                (v === 'SCOUT_RESULT' || v === 'CARD_DRAWN') &&
                obj.playerId !== p.playerId
              ) {
                throw new Error(`LEAK ${where}: another player's ${v}`);
              }
              if (k === 'reveal' && v !== null && (obj as Json).phase !== 'ROUND_ENDED')
                throw new Error(`LEAK ${where}: early reveal`);
              visit(v, [...path, k]);
            }
          };
          visit(body, []);
          if (ownPrivate) expect((body as Json).private.playerId, where).toBe(p.playerId);
        }
        for (const frame of p.frames) {
          let msg: Json;
          try {
            msg = JSON.parse(frame);
          } catch {
            continue;
          }
          const payload = Array.isArray(msg) ? msg[4] : msg.payload; // phoenix v2 arrays or v1 objects
          const event = Array.isArray(msg) ? msg[3] : msg.event;
          if (event === 'broadcast') {
            const inner = (payload?.payload ?? {}) as Json;
            for (const key of Object.keys(inner)) {
              if (!ALLOWED_BROADCAST_KEYS.has(key))
                throw new Error(`LEAK ${p.name} realtime frame key ${key}`);
            }
          }
        }
      }
    };

    // ---------------------------------------------------------------- start the game
    await sendCommand(A, () =>
      A.page.getByRole('button', { name: 'Започни играта', exact: true }).click(),
    );
    let { r: round, s: state } = await track();
    expect(
      (await sql`select count(*)::int as n from public.games where room_id = ${room!.id}`)[0]!.n,
    ).toBe(1);
    expect(round).toMatchObject({ round_no: 1, phase: 'ROUND_ACTIVE', version: 1 });
    await dismissRoleReveal(state!);
    for (const p of players) {
      await expect(hand(p).getByRole('button')).toHaveCount(6); // 3 players → 6 cards
      const board = p.page.getByRole('group', { name: 'Игрално поле' });
      await expect(board.locator('[data-part="matrix"] rect')).toHaveCount(45); // exactly 5 × 9
      for (const slot of [1, 2, 3])
        await expect(board.getByRole('img', { name: `Неразкрита цел (цел ${slot})` })).toHaveCount(
          1,
        );
    }
    const startEntrance = (round.public_state as Json).board;
    expect(startEntrance.destinations.map((d: Json) => [d.x, d.y])).toEqual([
      [8, -2],
      [8, 0],
      [8, 2],
    ]);
    log('game started: one game, private roles, 6-card hands, 5×9 board');

    // Visual check of the REAL running game at three sizes.
    const shotPlayer = byPlayerId(round.active_player_id)!;
    for (const vp of [
      { width: 390, height: 844 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await shotPlayer.page.setViewportSize(vp);
      await shotPlayer.page.waitForTimeout(400);
      expect(
        await shotPlayer.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      await shotPlayer.page.screenshot({
        path: `artifacts/local-visual/real-game-${vp.width}x${vp.height}.png`,
      });
    }
    await shotPlayer.page.setViewportSize({ width: 1366, height: 768 });

    // ---------------------------------------------------------------- turn driver
    const coverage = {
      place: 0,
      rotate: 0,
      discard: 0,
      breakTool: 0,
      repair: 0,
      repairDual: 0,
      survey: 0,
      collapse: 0,
      timeout: 0,
      realtimeChecks: 0,
    };
    let surveyMemory: { surveyor: Player; slot: number; identity: string } | null = null;
    let refreshDone = false;
    let offlineDone = false;

    const playOneTurn = async () => {
      const { r, s } = await track();
      const actor = byPlayerId(r.active_player_id)!;
      const me = s!.players.find((sp: Json) => sp.playerId === actor.playerId);
      const cards = me.hand.cards as Json[];
      const blocked = Object.values(me.tools).includes('BROKEN');
      const others = s!.players.filter((sp: Json) => !sp.hasLeft);
      const nameOf = (id: string) => byPlayerId(id)!.name;
      const hidden = (r.public_state.board.destinations as Json[]).filter(
        (d) => d.revealed === null,
      );
      const paths = Object.values(r.public_state.board.paths) as Json[];
      const idx = (pred: (c: Json) => boolean) => cards.findIndex(pred);
      const pick = async (i: number) => hand(actor).getByRole('button').nth(i).click();
      await expect(hand(actor).getByRole('button').first()).toBeEnabled({ timeout: 15_000 });

      // Survey
      let i = idx((c) => c.typeId === 'SCOUT');
      if (i >= 0 && hidden.length > 0 && coverage.survey < 2) {
        const slot = hidden[0].slot as number;
        await pick(i);
        const body = await sendCommand(actor, async () => {
          await actor.page
            .getByRole('button', { name: `Избери цел ${slot + 1} за разузнаване` })
            .click();
          await actor.page
            .getByRole('button', { name: `Погледни цел ${slot + 1}`, exact: true })
            .click();
        });
        const identity = s!.destinationIdentities[slot];
        expect(body.private).toContainEqual({
          kind: 'SCOUT_RESULT',
          playerId: actor.playerId,
          slot,
          identity,
        });
        const dialog = actor.page.getByRole('dialog', { name: 'Тайно разузнаване' });
        await expect(dialog).toContainText(
          identity === 'TREASURE' ? 'Тук има злато.' : 'Тук няма злато.',
        );
        await dialog.getByRole('button', { name: 'Разбрах' }).click();
        surveyMemory = { surveyor: actor, slot, identity };
        coverage.survey++;
        return r;
      }
      // Break a tool (prefer another player)
      for (const [ci, card] of cards.entries()) {
        if (!card.typeId.startsWith('BREAK_') || coverage.breakTool >= 2) continue;
        const tool = card.typeId.slice(6);
        const target = others.find(
          (sp: Json) => sp.playerId !== actor.playerId && sp.tools[tool] === 'INTACT',
        );
        if (!target) continue;
        await pick(ci);
        await sendCommand(actor, async () => {
          await actor.page
            .getByRole('button', { name: `Избери ${nameOf(target.playerId)}` })
            .first()
            .click();
          await actor.page
            .getByRole('button', {
              name: `Счупи ${TOOL_DEF[tool]} на ${nameOf(target.playerId)}`,
              exact: true,
            })
            .click();
        });
        coverage.breakTool++;
        return r;
      }
      // Repair (single or two-tool)
      for (const [ci, card] of cards.entries()) {
        if (!card.typeId.startsWith('REPAIR_')) continue;
        const tools = card.typeId.slice(7).split('_');
        const target = others.find((sp: Json) =>
          tools.some((t: string) => sp.tools[t] === 'BROKEN'),
        );
        if (!target) continue;
        const broken = tools.filter((t: string) => target.tools[t] === 'BROKEN');
        const tool = broken[0]!;
        await pick(ci);
        await sendCommand(actor, async () => {
          await actor.page
            .getByRole('button', { name: `Избери ${nameOf(target.playerId)}` })
            .first()
            .click();
          if (broken.length > 1) {
            await actor.page
              .getByRole('group', { name: 'Кой инструмент да се поправи?' })
              .getByRole('button', { name: TOOL_NOM[tool] })
              .click();
          }
          await actor.page
            .getByRole('button', {
              name: `Поправи ${TOOL_DEF[tool]} на ${nameOf(target.playerId)}`,
              exact: true,
            })
            .click();
        });
        coverage.repair++;
        if (tools.length > 1) coverage.repairDual++;
        return r;
      }
      // Cave-in (once, when there is something to remove)
      i = idx((c) => c.typeId === 'COLLAPSE');
      if (i >= 0 && paths.length >= 2 && coverage.collapse < 1) {
        const target = paths.reduce((a, b) => (b.x > a.x ? b : a));
        await pick(i);
        const collapseTargets = await actor.page
          .getByRole('button', { name: /^Срути тунела: / })
          .count();
        expect(collapseTargets).toBe(paths.length); // only placed tunnels, never entrance/destinations
        await sendCommand(actor, async () => {
          await actor.page
            .getByRole('button', { name: `Срути тунела: колона ${target.x}, ред ${target.y}` })
            .click();
          await actor.page.getByRole('button', { name: 'Срути тунела', exact: true }).click();
        });
        coverage.collapse++;
        return r;
      }
      // Tunnel placement toward the destinations (rotate when that is the only way, or once for coverage)
      if (!blocked) {
        for (const [ci, card] of cards.entries()) {
          if (!card.typeId.startsWith('PATH_')) continue;
          await pick(ci);
          let rotated = false;
          let cells = await legalCells(actor);
          if (cells.length === 0 || coverage.rotate === 0) {
            await actor.page.keyboard.press('r');
            const rotatedCells = await legalCells(actor);
            if (rotatedCells.length > 0) {
              cells = rotatedCells;
              rotated = true;
            } else {
              await actor.page.keyboard.press('r');
              cells = await legalCells(actor);
            }
          }
          for (const c of cells) {
            expect(
              c.x >= 0 && c.x <= 8 && c.y >= -2 && c.y <= 2,
              `legal cell inside 5×9: ${c.x},${c.y}`,
            ).toBe(true);
          }
          if (cells.length === 0) {
            await actor.page.keyboard.press('Escape');
            continue;
          }
          const best = cells.reduce((a, b) =>
            b.x > a.x || (b.x === a.x && Math.abs(b.y) < Math.abs(a.y)) ? b : a,
          );
          const body = await sendCommand(actor, () =>
            actor.page
              .getByRole('button', { name: `Постави тук: колона ${best.x}, ред ${best.y}` })
              .click(),
          );
          expect(body.version).toBe(r.version + 1);
          coverage.place++;
          if (rotated) coverage.rotate++;
          return r;
        }
      }
      // Discard (two-step)
      await pick(0);
      await sendCommand(actor, async () => {
        await actor.page.getByRole('button', { name: 'Изхвърли', exact: true }).click();
        await actor.page
          .getByRole('button', { name: 'Потвърди изхвърлянето', exact: true })
          .click();
      });
      coverage.discard++;
      return r;
    };

    // ---------------------------------------------------------------- three rounds
    let previousGameId = round.game_id as string;
    for (let roundNo = 1; roundNo <= 3; roundNo++) {
      let turns = 0;
      for (;;) {
        ({ r: round, s: state } = await track());
        if (round.phase !== 'ROUND_ACTIVE') break;
        turns++;
        expect(turns, 'a round never exceeds 66 turns').toBeLessThanOrEqual(67);

        // Timeout: let one real turn expire (round 1, turn 4). No scheduler involved.
        if (roundNo === 1 && round.turn_number === 4 && coverage.timeout === 0) {
          const victim = state!.players.find((sp: Json) => sp.playerId === round.active_player_id);
          const lowest = [...victim.hand.cards].sort(
            (a: Json, b: Json) => a.handPosition - b.handPosition,
          )[0];
          const eventsBefore = (
            await sql`select count(*)::int as n from public.round_events where round_id = ${round.id} and event->>'type' = 'TURN_TIMED_OUT'`
          )[0]!.n;
          log(`timeout: waiting for ${byPlayerId(victim.playerId)!.name}'s turn to expire (~60 s)`);
          await expect
            .poll(async () => (await current()).turn_number, {
              timeout: 90_000,
              intervals: [2_000],
            })
            .toBe(5);
          const after = await current();
          expect(after.version).toBe(round.version + 1); // exactly one transition
          expect(
            (
              await sql`select count(*)::int as n from public.round_events where round_id = ${round.id} and event->>'type' = 'TURN_TIMED_OUT'`
            )[0]!.n,
          ).toBe(eventsBefore + 1);
          const afterSecret = await secret(round.id);
          const victimAfter = afterSecret!.players.find(
            (sp: Json) => sp.playerId === victim.playerId,
          );
          expect(victimAfter.hand.cards.map((c: Json) => c.id)).not.toContain(lowest.id); // lowest handPosition discarded
          expect(victimAfter.hand.cards).toHaveLength(victim.hand.cards.length); // replacement drawn
          for (const p of players) await expect(p.page.getByRole('alert')).toHaveCount(0); // lost races stay quiet
          coverage.timeout++;
          continue;
        }

        // Offline/online convergence (round 1, turn 6): one client misses a move, then catches up.
        if (roundNo === 1 && round.turn_number >= 6 && !offlineDone) {
          const offline = players.find((p) => p.playerId !== round.active_player_id)!;
          await offline.context.setOffline(true);
          await playOneTurn();
          await waitVersion(round.id, round.version);
          const target = (await current()).version;
          await offline.context.setOffline(false);
          await expect
            .poll(
              () =>
                offline.payloads.some(
                  (x) =>
                    x.url.includes('get_game_snapshot') &&
                    (x.body as Json)?.snapshot?.round?.version >= target,
                ),
              { timeout: 30_000 },
            )
            .toBe(true);
          offlineDone = true;
          log(`reconnect: ${offline.name} converged to version ${target}`);
          continue;
        }

        const before = round.version;
        const snapshotsBefore = players.map(
          (p) => p.payloads.filter((x) => x.url.includes('get_game_snapshot')).length,
        );
        const r = await playOneTurn();
        await waitVersion(r.id, before);

        // Realtime: the two other clients refetch within seconds (polling would take 30 s).
        if (coverage.realtimeChecks < 4) {
          const actorIndex = players.findIndex((p) => p.playerId === r.active_player_id);
          for (const [pi, p] of players.entries()) {
            if (pi === actorIndex) continue;
            await expect
              .poll(() => p.payloads.filter((x) => x.url.includes('get_game_snapshot')).length, {
                timeout: 6_000,
              })
              .toBeGreaterThan(snapshotsBefore[pi]!);
          }
          coverage.realtimeChecks++;
        }

        // Refresh recovery of the surveyor (identity, seat, role, hand, survey memory).
        if (surveyMemory && !refreshDone) {
          const { surveyor, slot } = surveyMemory;
          await surveyor.page.reload();
          await expect(hand(surveyor)).toBeVisible({ timeout: 20_000 });
          expect(await userIdOf(surveyor)).toBe(surveyor.userId);
          // Private memory under the surveyor's hand; the shared board never varies by identity.
          const memory = `цел ${slot + 1}: ${surveyMemory.identity === 'TREASURE' ? 'Злато' : 'Празна цел'}`;
          await expect(surveyor.page.getByLabel(PRIVATE_SURVEY_LABEL)).toContainText(memory);
          for (const p of players.filter((q) => q !== surveyor)) {
            const own = await p.page.getByLabel(PRIVATE_SURVEY_LABEL).allTextContents();
            // Others may have their own surveys, never this one unless they surveyed it themselves.
            if (own.join().includes(memory)) {
              const sp = (await secret((await current()).id))?.players.find(
                (x: Json) => x.playerId === p.playerId,
              );
              expect(sp?.knownDestinations.some((k: Json) => k.slot === slot)).toBe(true);
            }
          }
          const { s: fresh } = await track();
          if (fresh) {
            const mine = fresh.players.find((sp: Json) => sp.playerId === surveyor.playerId);
            await expect(hand(surveyor).getByRole('button')).toHaveCount(mine.hand.cards.length);
          }
          refreshDone = true;
          log(`refresh: ${surveyor.name} recovered identity, hand and private survey memory`);
        }
      }

      // ------------------------------------------------------------ round end
      ({ r: round } = await track());
      assertPrivacy();
      const reveal = (await sql`select reveal from public.rounds where id = ${round.id}`)[0]!
        .reveal as Json;
      const totals =
        await sql`select player_id, sum(points)::int as total, count(*) filter (where points > 0)::int as won from public.score_entries where game_id = ${round.game_id} group by player_id`;
      log(`round ${roundNo} ended: ${round.winner} / ${round.end_reason} after ${turns} turns`);
      const finished = round.game_status === 'FINISHED';
      for (const p of players) {
        const dialog = p.page.getByRole('dialog', {
          name: finished ? 'Край на играта' : `Край на рунд ${roundNo}`,
        });
        await expect(dialog).toBeVisible({ timeout: 15_000 });
        if (!finished) {
          const headline = {
            MINER: 'Джуджетата откриха златото!',
            DISRUPTOR: 'Саботьорите успяха!',
            NONE: 'Рундът приключи без победител.',
          }[round.winner as string]!;
          await expect(dialog).toContainText(headline);
          for (const rr of reveal.roles) {
            await expect(dialog).toContainText(
              `${byPlayerId(rr.playerId)!.name}: ${rr.role === 'MINER' ? 'Джудже' : 'Саботьор'}`,
            );
          }
          for (const tt of totals) {
            await expect(
              dialog.getByRole('row', { name: new RegExp(byPlayerId(tt.player_id)!.name) }),
            ).toContainText(String(tt.total));
          }
        } else {
          await expect(dialog.getByRole('button', { name: /^Започни рунд 4/ })).toHaveCount(0);
          // Shared ranks: rank = 1 + number of players strictly better on (total, roundsWon).
          const rows = await dialog.getByRole('row').allTextContents();
          for (const tt of totals) {
            const rank =
              1 +
              totals.filter((o) => o.total > tt.total || (o.total === tt.total && o.won > tt.won))
                .length;
            expect(
              rows.some(
                (row) => row.startsWith(`${rank}.`) && row.includes(byPlayerId(tt.player_id)!.name),
              ),
            ).toBe(true);
          }
        }
      }
      if (finished) break;

      // Next round by the host; new deal, cumulative scores retained.
      const handsBefore = new Set(Object.values(players).flatMap((p) => [...p.handsEver]));
      await sendCommand(A, () =>
        A.page
          .getByRole('dialog')
          .getByRole('button', { name: `Започни рунд ${roundNo + 1}` })
          .click(),
      );
      ({ r: round, s: state } = await track());
      expect(round).toMatchObject({ round_no: roundNo + 1, phase: 'ROUND_ACTIVE', version: 1 });
      expect(Object.keys(round.public_state.board.paths)).toHaveLength(0);
      const newHands = state!.players.flatMap((sp: Json) => sp.hand.cards.map((c: Json) => c.id));
      expect(newHands.some((id: string) => handsBefore.has(id))).toBe(false); // fresh card instances
      expect(
        (
          await sql`select count(distinct round_no)::int as n from public.score_entries where game_id = ${round.game_id}`
        )[0]!.n,
      ).toBe(roundNo);
      await dismissRoleReveal(state!);
    }

    // ---------------------------------------------------------------- game over → play again
    expect(round.round_no).toBe(3);
    log(`coverage: ${JSON.stringify(coverage)}`);
    await A.page
      .getByRole('dialog', { name: 'Край на играта' })
      .getByRole('button', { name: 'Играй отново' })
      .click();
    await expect(A.page.getByRole('button', { name: 'Започни играта', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    expect(A.page.url()).toBe(roomUrl); // same room code
    for (const p of [B, C])
      await expect(p.page.getByRole('button', { name: 'Готов съм', exact: true })).toBeVisible({
        timeout: 15_000,
      });
    expect(
      (
        await sql`select bool_or(is_ready) as any from public.room_players where room_id = ${room!.id} and status = 'ACTIVE'`
      )[0]!.any,
    ).toBe(false);
    expect(
      (
        await sql`select count(*)::int as n from private.round_secrets s join public.rounds r on r.id = s.round_id where r.game_id = ${previousGameId}`
      )[0]!.n,
    ).toBe(0);
    for (const p of [B, C])
      await p.page.getByRole('button', { name: 'Готов съм', exact: true }).click();
    await expect(A.page.getByRole('button', { name: 'Започни играта', exact: true })).toBeEnabled({
      timeout: 10_000,
    });
    await sendCommand(A, () =>
      A.page.getByRole('button', { name: 'Започни играта', exact: true }).click(),
    );
    ({ r: round, s: state } = await track());
    expect(round.game_id).not.toBe(previousGameId);
    expect(round).toMatchObject({ round_no: 1, phase: 'ROUND_ACTIVE' });
    await dismissRoleReveal(state!);
    previousGameId = round.game_id;
    assertPrivacy();
    log('play again: same room, readiness reset, old secrets gone, new game started');

    // Coverage of the main actions (cards are random; these are the ones the deal allowed).
    expect(coverage.place).toBeGreaterThan(0);
    expect(coverage.discard).toBeGreaterThan(0);
    expect(coverage.timeout).toBe(1);
    expect(offlineDone && refreshDone).toBe(true);
    test.info().annotations.push({ type: 'coverage', description: JSON.stringify(coverage) });
  } finally {
    await sql.end();
    await Promise.all(players.map((p) => p.context.close()));
  }
});
