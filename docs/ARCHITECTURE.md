# ARCHITECTURE — v1

> Status: **Specification v1 (Prompt 0, owner decisions finalised)**. Rules: [GAME_RULES.md](GAME_RULES.md). Security: [SECURITY_MODEL.md](SECURITY_MODEL.md).

---

## 0. Owner-approved decisions (final)

| ID | Decision | Where specified |
|---|---|---|
| D1 | **Authoritative engine.** Gameplay rules exist only in the pure TypeScript domain (`src/domain`). Authoritative gameplay commands run in Supabase Edge Functions. Each one authenticates the caller, loads the authoritative state, invokes the domain, and persists atomically through one tightly restricted DB function with optimistic version checks. Stale and duplicate commands are rejected. The rules are **not** reimplemented in PL/pgSQL. The DB owns constraints, ownership, RLS, atomic persistence, version checks and integrity. Client use of the domain is for UX previews only and is never authoritative. | §1.1, §3.1–§3.3, §8 |
| D2 | **Seat recovery.** Identity equals the Supabase anonymous auth session. Refresh, reconnect and reopening the app in the same browser profile restore the seat. Cross-device recovery, recovery after cleared storage, rejoin tokens and permanent accounts are **out of scope for v1**. | §9.1 |
| D3 | **Destinations.** They never make a legal placement illegal, but they are not connectivity wildcards: they connect only through a neighbouring card's open facing side. Reaching one that way reveals it, and a revealed empty one stays traversable. This is an intentional original rule. | GAME_RULES §4.6, §7.3 |
| D4 | **Turn deadlines without a scheduler.** Each turn has a server-authoritative deadline. After it passes, any connected member may call `resolveExpiredTurn`. The server verifies that the turn is current, has expired, is unresolved and is at the current version. The timeout discards the lowest server-owned `handPosition`, draws and advances in the same atomic transition. **Active gameplay never depends on pg_cron or any background job.** The maintenance job is only a safety net for abandoned games and data cleanup. | §8.1, §8.3, GAME_RULES §6.2, §8.5 |

---

## 1. System overview

```
┌─────────────────────────── Browser (Netlify static SPA) ───────────────────────────┐
│ React UI ──intent──▶ command client ──HTTPS──▶ Edge Function `game-command`         │
│    ▲                    │                       (game commands)                    │
│    │                    └──HTTPS──▶ Postgres RPC (lobby commands, snapshot reads)   │
│ TanStack Query cache ◀── refetch ◀── Realtime Broadcast ping {type, version}         │
│    ▲                                                                                │
│ src/domain (pure TS) — used for legal-move hints, rendering helpers, i18n keys     │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                       │
┌──────────────────────────────── Supabase ─────────────────────────────────────────┐
│ Auth (anonymous + CAPTCHA)                                                        │
│ Edge Functions (Deno): game-command (authoritative), game-maintenance (safety net)│
│   └─ imports the SAME src/domain code (synced copy, see §3.3)                     │
│ Postgres: public tables (RLS SELECT for members), private tables (RLS owner),     │
│           secret tables (no client access), SECURITY DEFINER persistence fns      │
│ Realtime: private channel `room:{roomId}` — broadcast pings + presence            │
│ pg_cron: OPTIONAL safety net only — abandoned games + data cleanup (never turns)  │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Core principles

1. **The server is authoritative.** Every state change happens in a server transaction. The client sends *intent* only.
2. **One rules implementation.** Game rules exist once, as pure TypeScript in `src/domain`. The Edge Function runs them authoritatively and the client uses them only for hints. SQL does persistence, access control and atomic compare-and-swap. It does **not** reimplement game rules.
3. **The database is the source of truth.** Realtime messages are content-free pings that trigger a refetch.
4. **Hidden information is separated by storage, not by filtering in the UI.** Secret, private and public data live in different tables with different access rules.
5. **Determinism.** Domain functions take explicit `seed`, `now` and inputs. There is no hidden randomness, clock or I/O.
6. **Progress is driven by requests, not schedulers.** Every state transition, including expired turns, the next round after the results deadline, and host migration, is triggered by a verified request from a connected member. Background jobs never move an active game forward.

---

## 2. Layer boundaries

| Layer | Location | May import | Must not |
|---|---|---|---|
| Domain | `src/domain/**` | only other domain files | React, Supabase, `window`, `Date.now()`, `Math.random()`, `fetch`, Node/Deno APIs |
| Server (Edge Functions) | `supabase/functions/**` | domain (synced copy), Supabase admin client | Trust any client-supplied state other than intent |
| SQL | `supabase/migrations/**` | — | Contain game rules beyond simple invariants (version CAS, membership, capacity) |
| Data access (client) | `src/lib/api/**` | supabase-js, domain *types* | Render UI |
| Features / UI | `src/features/**`, `src/components/**` | domain (pure helpers), lib | Call supabase-js directly (it must go through `src/lib/api`) |

These boundaries are enforced by ESLint `no-restricted-imports` rules, or by `eslint-plugin-boundaries` if that is chosen during implementation.

---

## 3. Project structure (proposed)

```
/
├─ docs/                          # this spec
├─ src/
│  ├─ domain/                     # PURE. No React/Supabase/browser.
│  │  ├─ config/                  # all tunable numbers from GAME_RULES
│  │  │  ├─ players.ts            # MIN/MAX, hand sizes
│  │  │  ├─ roles.ts              # role pools by player count
│  │  │  ├─ deck.ts               # card catalog + quantities
│  │  │  ├─ board.ts              # bounds, start, destination slots
│  │  │  ├─ timing.ts             # timeouts
│  │  │  └─ scoring.ts
│  │  ├─ rng/                     # seeded PRNG, shuffle, id generation
│  │  ├─ board/                   # Direction, topology, rotate, edges, reachability, placement legality
│  │  ├─ cards/                   # card type registry, category resolvers
│  │  ├─ deck/                    # build/shuffle/draw
│  │  ├─ roles/                   # role registry, pool building, dealing
│  │  ├─ turns/                   # next eligible player, timeout handling
│  │  ├─ scoring/                 # round scoring, ranking
│  │  ├─ game/                    # RoundState, applyCommand, createRound, projections
│  │  ├─ errors.ts                # DomainErrorCode union
│  │  └─ index.ts                 # public API surface
│  ├─ app/                        # router, providers, error boundary, layout
│  ├─ features/
│  │  ├─ landing/
│  │  ├─ lobby/
│  │  ├─ game/                    # board, hand, players panel, action flow
│  │  ├─ results/
│  │  └─ session/                 # anon auth bootstrap, multi-tab coordination
│  ├─ components/                 # generic UI primitives (Button, Dialog, Toast…)
│  ├─ lib/
│  │  ├─ supabase/                # client singleton
│  │  ├─ api/                     # typed RPC + edge command wrappers, error mapping
│  │  ├─ realtime/                # channel subscription → query invalidation
│  │  ├─ query/                   # query keys, QueryClient config
│  │  ├─ errors/                  # error reporting abstraction
│  │  ├─ audio/                   # (later) SFX manager
│  │  └─ storage/                 # safe localStorage wrapper
│  ├─ i18n/                       # bg.ts (+ en.ts later), t() helper, types
│  └─ main.tsx
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/                 # SQL (Prompt 4+)
│  ├─ functions/
│  │  ├─ _shared/
│  │  │  ├─ domain/               # GENERATED copy of src/domain (sync script, CI-verified)
│  │  │  ├─ auth.ts, db.ts, rateLimit.ts, responses.ts
│  │  ├─ game-command/index.ts
│  │  └─ game-maintenance/index.ts
│  └─ tests/                      # pgTAP database/security tests (Tier C)
├─ tests/
│  ├─ e2e/                        # Playwright (Tier C)
│  ├─ integration/                # Edge function + local Supabase (Tier B selected / C)
│  └─ sim/                        # large simulations (Tier D)
├─ scripts/                       # sync-domain, check-domain-sync, seed helpers
├─ public/_headers                # Netlify security headers
└─ netlify.toml
```

### 3.0 As implemented (Prompt 1)

The structure above is the target. Prompt 1 created the domain plus a minimal shell, with these refinements:

- `src/domain/` also has `hands/` (hand-position model), `tools/` (tool state), `rng/` (PRNG, shuffle, card ids) and `testing/` (test-only builders, **excluded** from the future Edge sync). Shared root files: `primitives.ts`, `result.ts`, `errors.ts`, `version.ts` (`RULES_VERSION = 1`), `index.ts` (public API).
- Shell: `src/app/` (App, routes, RootLayout, queryClient), `src/pages/` (Home, NotFound, RouteError), `src/styles/index.css` (Tailwind v4 theme tokens, focus ring, reduced motion), `src/i18n/` (typed `bg` dictionary plus `t()`), `src/test/setup.ts`.
- **PRNG:** seed string → `cyrb128` → `xoshiro128**`, with rejection-sampled `nextInt` and Fisher–Yates `shuffle` (GAME_RULES §2.3 leaves the exact PRNG to `src/domain/rng/`). Changing it changes every seeded round, so it requires a `RULES_VERSION` bump.
- **Command boundary:** `applyCommand(state, actorId, command, { now, expectedVersion? })`. No randomness parameter is needed, because all randomness is consumed in `createRound` from the server seed. `expectedVersion` is checked inside the domain at the position GAME_RULES requires: before the turn check for card plays, and after the turn and deadline checks for `RESOLVE_EXPIRED_TURN`. The Edge layer will still perform the persistence CAS.
- Card categories follow GAME_RULES §5.3 (`PATH | SABOTAGE | REPAIR | INSPECT | BOARD`). `cardKind()` derives `PATH | ACTION`.
- `CommandOutcome = { state, events (public, sequenced), privateEffects (per player), roundScores | null }` keeps public and private results separate for the future projections and persistence.
- **Interpretation (no rule change):** when the timed-out player sends `RESOLVE_EXPIRED_TURN` for their own turn, their timeout counter still increases. Only a *different* member's successful resolve request resets that member's own counter.

### 3.1 Domain module conventions

- TypeScript `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Relative imports **with explicit `.ts` extensions**, so the same files run in Vite and in Deno. Root tsconfig: `allowImportingTsExtensions: true` and `noEmit: true` for type checking (Vite handles emission).
- Data is immutable: functions return new objects. Plain JSON-serialisable shapes only (no `Map`, `Set` or classes in persisted state). Sets become sorted arrays.
- Errors are returned as values (`Result<T, DomainError>`), not thrown, for expected rule violations.

### 3.2 Domain public API (sketch)

```ts
createRound(input: {
  config: GameConfig; players: SeatedPlayer[]; roundNo: number;
  seed: string; previousStartingSeat: number | null; now: number;
}): RoundState

applyCommand(state: RoundState, actor: PlayerId, cmd: GameCommand, now: number):
  Result<{ state: RoundState; events: PublicEvent[]; privateNotes: PrivateNote[] }, DomainError>

projectPublic(state: RoundState): PublicRoundView           // safe for all members
projectPrivate(state: RoundState, p: PlayerId): PrivateView // safe for that player only
projectReveal(state: RoundState): RevealView | null         // only when phase = ROUND_ENDED

legalPlacements(board: PublicBoard, card: PathCardType, rot: Rotation): Cell[]
isPlacementLegal(board: PublicBoard, card, rot, cell): Result<void, DomainError>
scoreRound(state: RoundState): ScoreEntry[]
rankPlayers(totals: PlayerTotals[]): RankedPlayer[]
```

`GameCommand` is a discriminated union: `PLAY_PATH | PLAY_ACTION | DISCARD | RESOLVE_EXPIRED_TURN | LEAVE`. `START_GAME` and `START_NEXT_ROUND` use `createRound` plus game-level helpers.

The domain also exports `RULES_VERSION`, an integer that increases whenever the rules or the state shape change in an incompatible way (§3.3).

### 3.3 Packaging shared domain code (browser + Edge Functions)

The same pure rules must run in the browser (Vite bundle, UX previews only) and in Supabase Edge Functions (Deno, authoritative). Compatibility is guaranteed by **constraints on the domain source**, not by a build artefact:

| Constraint | Enforcement |
|---|---|
| Zero runtime dependencies: no npm or Deno imports, only relative imports inside `src/domain` | ESLint `no-restricted-imports` for `src/domain/**`. A CI script also greps for non-relative imports. |
| Relative imports with **explicit `.ts` extensions** (valid in both Vite and Deno) | `allowImportingTsExtensions: true` and `noEmit: true`, plus lint rule `import/extensions` |
| No DOM, browser, Node or Deno globals (`window`, `document`, `localStorage`, `fetch`, `crypto`, `Deno`, `process`, `Date.now`, `Math.random`, `setTimeout`) | A dedicated `tsconfig.domain.json` with `lib: ["ES2022"]` (**no `DOM`**) and `types: []`, so using these is a type error. Clock-like and random globals are banned by ESLint `no-restricted-globals` and `no-restricted-properties`. |
| No React and no Supabase | ESLint boundaries (§2) |
| Plain-JSON state (no classes, `Map`, `Set` or `Date` objects) | Types, plus a unit test that round-trips state through `JSON.parse(JSON.stringify(...))` |
| Randomness and time are injected | `seed` (generated by the Edge Function with `crypto.getRandomValues`) and `now` (server clock) are parameters |

Distribution:

- **Browser:** Vite imports `src/domain/index.ts` directly. Only pure helpers are used: `legalPlacements`, topology for rendering, type definitions and error codes. The client never sees `createRound` inputs such as seeds, because it never has them.
- **Edge Functions:** `scripts/sync-domain` copies `src/domain/**` (excluding `*.test.ts`) **byte-for-byte** into `supabase/functions/_shared/domain/`. Edge code imports `../_shared/domain/index.ts`. The copy is committed so `supabase functions deploy` is self-contained and reviewable.
- **Drift protection:** `scripts/check-domain-sync` compares hashes and **fails** the build (`npm run build`, Tier B) if the copy differs. Edge Functions are type-checked with `deno check` in Tier B **only when** `supabase/functions/**` or `src/domain/**` changed.
- **Version handshake:** both sides read `RULES_VERSION` from the domain. The client sends it as the header `x-rules-version`. The Edge Function rejects a mismatch with `CLIENT_OUTDATED`, and the client prompts a reload. This prevents an old cached bundle from previewing outdated rules.
- If Supabase CLI bundling can resolve imports outside `supabase/functions/` at implementation time, the sync copy may be replaced by a direct relative import. All constraints above still apply. Prompt 5 checks this.

---

## 4. State model and state machines

### 4.1 Mapping the requested lifecycle to persisted states

| Requested lifecycle stage | Persisted representation |
|---|---|
| WAITING_FOR_PLAYERS | `rooms.status = 'LOBBY'` |
| ROUND_SETUP | Transient: happens *inside* the `START_GAME`/`START_NEXT_ROUND` transaction. Never visible to clients. |
| PLAYER_TURN | `rounds.phase = 'ROUND_ACTIVE'` (`active_seat`, `turn_number`, `turn_deadline`) |
| ROUND_RESOLUTION | Transient: happens inside the transaction of the command that ended the round |
| ROUND_RESULTS | `rounds.phase = 'ROUND_ENDED'` with `games.status = 'IN_PROGRESS'` |
| NEXT_ROUND | The `START_NEXT_ROUND` command |
| GAME_FINISHED | `games.status = 'FINISHED'` (or `'ABANDONED'`), `rooms.status = 'FINISHED'` |

### 4.2 Room state machine

```
          create_room
              │
              ▼
          ┌───────┐ start_game (host, ≥3, all ready) ┌──────────┐
          │ LOBBY │ ───────────────────────────────▶│ IN_GAME  │
          └───────┘                                  └──────────┘
             ▲  │ all members left / 30 min idle          │ game FINISHED/ABANDONED
             │  ▼                                         ▼
             │ ┌────────┐                           ┌──────────┐
             │ │ CLOSED │◀── all left / 30 min idle ─│ FINISHED │
             │ └────────┘                           └──────────┘
             └──────────── reset_room (host "Нова игра") ──┘
```

| From | Event | To | Guard |
|---|---|---|---|
| — | `create_room` | LOBBY | caller passes the rate limit; capacity is in 3–10 |
| LOBBY | `start_game` | IN_GAME | caller is the host; 3 ≤ members ≤ capacity; all non-host members ready |
| IN_GAME | game ends | FINISHED | — |
| FINISHED | `reset_room` | LOBBY | caller is the host; ready flags reset |
| any non-CLOSED | last member leaves, or maintenance idle rule | CLOSED | — |

### 4.3 Membership state machine (`room_players.status`)

```
join_room ──▶ ACTIVE ──leave_room──▶ LEFT
                 │
                 └── kick (host, LOBBY only) / lobby stale 120 s ──▶ REMOVED
```

- Connection is **derived**, not a state: `CONNECTED` if `now − last_seen_at < 45 s`, `AWAY` if under 120 s, otherwise `DISCONNECTED`. Presence in Realtime gives instant UI feedback, but server decisions use `last_seen_at` only.
- Rejoining after `LEFT` or `REMOVED` while in LOBBY creates a **new** ACTIVE row with a new seat. Rejoining during IN_GAME after leaving is rejected.

### 4.4 Game / round state machine

```
START_GAME ─▶ round 1 ROUND_ACTIVE ──(treasure | exhaustion | <2 players)──▶ ROUND_ENDED
                                                                               │
              ┌──────── START_NEXT_ROUND (host, or anyone after deadline) ◀───┤ if round < 3 and ≥3 members
              ▼                                                                │
         round n+1 ROUND_ACTIVE ...                                            └─▶ GAME FINISHED
```

Within ROUND_ACTIVE, each committed command is one transition `version → version+1`.

### 4.5 Command catalogue

| Command | Transport | Caller | Effect |
|---|---|---|---|
| `create_room(name, capacity, captcha?)` | SQL RPC | any authenticated | New room, caller becomes host at seat 0 |
| `join_room(code, name)` | SQL RPC | any authenticated | Adds a member, or is a no-op returning the existing membership if already ACTIVE |
| `leave_room(room_id)` | SQL RPC (LOBBY/FINISHED) · Edge `LEAVE` (IN_GAME) | member | Marks LEFT. In-game, the domain handles the hand and turn. |
| `set_ready(room_id, ready)` | SQL RPC | non-host member, LOBBY | toggles ready |
| `update_room_settings(room_id, capacity)` | SQL RPC | host, LOBBY | capacity ≥ member count |
| `kick_player(room_id, player_id)` | SQL RPC | host, LOBBY | sets REMOVED |
| `heartbeat(room_id)` | SQL RPC | member | updates `last_seen_at`. Every 15 s while the tab is visible, every 60 s while hidden. |
| `claim_host(room_id)` | SQL RPC | member | Succeeds only if the host is stale for over 60 s. The new host is chosen by the deterministic rule in §6, whoever the caller is. |
| `reset_room(room_id)` | SQL RPC | host, FINISHED | back to LOBBY |
| `START_GAME` | Edge | host | creates the game and round 1 |
| `PLAY_PATH` / `PLAY_ACTION` / `DISCARD` | Edge | active player | one turn |
| `RESOLVE_EXPIRED_TURN` (`resolveExpiredTurn`) | Edge | **any connected member**, after `turn_deadline` | Server-verified auto-discard of the lowest `handPosition`, draw and advance (§8.1) |
| `START_NEXT_ROUND` | Edge | host, or any member after `results_deadline` (server-verified) | next round or finish |
| `get_room_snapshot(room_id, since_seq?)` | SQL RPC (SECURITY INVOKER) | member | read model |
| `get_my_active_room()` | SQL RPC | any authenticated | reconnect discovery |

**There is no separate `finish_turn` command.** Drawing and advancing the turn are part of the same atomic transaction as the action (GAME_RULES §8.3). This removes a whole class of "half-finished turn" states.

Every Edge command body:

```json
{ "type": "PLAY_PATH", "roomId": "...", "roundId": "...", "expectedVersion": 42,
  "commandId": "uuid-v4", "payload": { "cardId": "c…", "x": 3, "y": -1, "rotation": 180 } }
```

The response is `{ ok: true, version, private?: {...} }` or `{ ok: false, code, currentVersion? }`.

---

## 5. Conceptual database model

Conventions: UUID primary keys, `timestamptz`, RLS **enabled on every table**, `anon` and `authenticated` have **no direct INSERT/UPDATE/DELETE** on any table. All writes go through SECURITY DEFINER functions or the Edge Function (service role). Anonymous users have the Postgres role `authenticated` with the JWT claim `is_anonymous = true`.

Helper: `is_room_member(room_id) returns boolean`, SECURITY DEFINER and STABLE. It checks for an ACTIVE `room_players` row with `user_id = auth.uid()`, and avoids RLS recursion.

| Entity | Purpose | Visibility | Client SELECT | Client writes | Key constraints |
|---|---|---|---|---|---|
| `rooms` | Room metadata: code, status, capacity, host_player_id, current_game_id, `room_version` | Members | ✅ members only (codes are not enumerable) | ❌ RPC only | `code` unique among non-CLOSED rooms; capacity 3–10; status enum |
| `room_players` | Membership: user_id, display_name, seat, is_ready, status, last_seen_at | Members (excluding `user_id` of others, see note) | ✅ members, via the view `room_players_public` | ❌ | unique (room_id, user_id) where ACTIVE; unique (room_id, seat) where ACTIVE; unique (room_id, lower(name)) where ACTIVE; seat < capacity |
| `games` | One game: mode, status, total_rounds, current_round_no, end_reason | Members | ✅ | ❌ | one IN_PROGRESS game per room (partial unique) |
| `rounds` | Public round header plus `public_state jsonb` (board, tools, hand counts, deck count, discard count, revealed destinations, active seat, deadline), `phase`, `state_version`, `last_event_seq`, and after the end `reveal jsonb` (roles, set-aside, destinations) | Members | ✅ | ❌ | unique (game_id, round_no); `reveal` is NULL while ACTIVE (CHECK constraint) |
| `round_events` | Public event log (GAME_RULES §11) | Members | ✅ | ❌ | PK (round_id, seq) |
| `round_player_private` | Per player per round: `private_state jsonb` (hand as `[{cardId, typeId, handPosition}]` sorted by `handPosition`, role, known destinations), `version` | **The owner only** | ✅ `user_id = auth.uid()` | ❌ | PK (round_id, player_id) |
| `round_secrets` | Full authoritative `RoundState` jsonb (seed, deck order, every hand with `handPosition`s and each player's `nextHandPosition`, every role, destination identities), `version` | **Server only** | ❌ no policies, plus REVOKE ALL from anon/authenticated | ❌ | PK round_id. Deleted when the round ends. |
| `score_entries` | Points per (game, round, player) and reason | Members | ✅ | ❌ | unique (game_id, round_no, player_id) |
| `command_log` | Idempotency: command_id, user_id, round_id, type, outcome, response jsonb | Server only | ❌ | ❌ | PK command_id; retained 24 h |
| `rate_limit_buckets` | Per (user_id, action, window) counters | Server only | ❌ | ❌ | — |
| `client_error_reports` | Truncated client error reports | Server only | ❌ | ❌ (insert through the RPC `report_client_error`, rate limited) | 14-day retention |

**Note on `room_players.user_id`:** other members never need anyone else's auth UID. Clients read the view `room_players_public`, which exposes `player_id, seat, display_name, is_ready, status, last_seen_at, is_host, is_me`. The base table has no SELECT policy for clients.

**Why JSONB snapshots instead of normalised board rows:** the board holds at most about 70 cells and is always read whole. The domain already produces exact projections. Writing three projections (public, private per player, secret) in one transaction keeps them consistent and keeps SQL free of rules. Indexed columns (`phase`, `state_version`, `active_seat`, `turn_deadline`) are duplicated beside the JSON for queries and cron.

### 5.1 Persistence function (the only writer of game state)

`persist_round_transition(round_id, expected_version, secret_state, public_state, private_states[], events[], round_header, score_entries[], game_patch, room_patch, command_meta)`

- SECURITY DEFINER. EXECUTE is granted **only** to `service_role`.
- `UPDATE round_secrets SET state=…, version=version+1 WHERE round_id=$1 AND version=$2`. If 0 rows are updated, it raises `STALE_STATE` and nothing is written.
- Writes rounds, private rows, events, scores, game and room patches, and the command_log row, all in one transaction.
- At the end it calls `realtime.send(...)` with a broadcast ping to the private topic `room:{room_id}`.

A matching `persist_round_start(...)` creates a round (it inserts instead of updating with CAS).

### 5.2 Indexes (initial)

- `rooms(code) WHERE status <> 'CLOSED'` (unique)
- `room_players(room_id, status)`, `room_players(user_id, status)`
- `rounds(game_id, round_no)`, `rounds(phase, updated_at)` for the abandoned-game safety net
- `round_events(round_id, seq)`
- `command_log(created_at)`, `rate_limit_buckets(user_id, action, window_start)`

---

## 6. Lobby details

- **Room code generation:** inside `create_room`, generate 6 random characters from `gen_random_bytes` over the alphabet. Retry up to 10 times on collision with a non-CLOSED room.
- **Seat assignment:** the lowest free seat in `0..capacity−1` among ACTIVE members, under a `SELECT … FOR UPDATE` lock on the room row, so concurrent joins cannot oversubscribe.
- **Capacity enforcement:** in `join_room` under the same lock: `count(ACTIVE) < capacity`, otherwise `ROOM_FULL`.
- **Ready:** the host has no ready flag (starting implies ready). `start_game` re-checks every guard under the lock.
- **Lazy stale-member removal (no scheduler needed):** `join_room`, `set_ready`, `update_room_settings` and `start_game` first mark ACTIVE members of a LOBBY room whose `last_seen_at` is older than 120 s as REMOVED, under the room lock, before evaluating capacity and readiness. Capacity and start correctness therefore never wait on a cron job.
- **Host migration:** `rooms.host_player_id`. It triggers when (a) the host leaves, which reassigns immediately inside `leave_room`, or (b) the host is stale for over 60 s and a connected member's client calls `claim_host`. Clients call it automatically when they see a stale host. The lazy lobby removal above also reassigns the host when it removes the host. The new host is the lowest seat among ACTIVE members with `last_seen_at` within 45 s. If none qualify, the lowest seat among ACTIVE members is chosen. Each change bumps `room_version` and sends a broadcast.
- **Name validation (server):** trim, NFC, collapse repeated whitespace, length 2–20, allowlist of Latin/Greek/Cyrillic letters, ASCII digits, space and `. _ -` (owner decision: no other scripts in v1). Control and bidi-override characters are rejected by the allowlist.

---

### 6.1 As implemented (Prompt 2: lobby)

Migrations: `supabase/migrations/20261006100000_lobby_schema.sql`, `…100100_lobby_functions.sql`, `…100200_lobby_realtime.sql`.

- **Tables:** `public.rooms` and `public.room_players` (memberships). Bookkeeping lives in `private.rate_limits`. The `private` schema is not exposed by the Data API. No game, round or secret tables exist yet.
- **Reads:** clients have **no direct table privileges at all**, not even SELECT. Everything is read through `get_room_snapshot(p_code)`. This is narrower than §5, which allowed member SELECT on `rooms` and a `room_players_public` view. The snapshot is SECURITY DEFINER with an explicit membership check, because it must compute `isMe`/`isHost` without exposing `user_id`. It takes the **room code** (the route parameter), and an unknown code returns the same `NOT_ROOM_MEMBER` as non-membership.
- **RPC result envelope:** lobby RPCs return `{ ok: true, … }` or `{ ok: false, error: CODE }` instead of raising. The transaction therefore commits, so rate-limit counters and lazy cleanup persist even for rejected requests; with raised errors, failed code-guessing joins would never be counted. All validation runs before the requested mutation. Unexpected failures still raise.
- **RPCs:** `create_room`, `join_room` (idempotent for an existing member), `leave_room` (lobby/finished only; in-game leave will be the Edge `LEAVE`), `set_ready` (own row only; host gets `HOST_CANNOT_READY`), `heartbeat`, `claim_host`, `update_room_settings` (capacity; shrinking re-seats players onto the lowest free seats), `kick_player` (host, lobby, sets `REMOVED`), `get_room_snapshot`, `get_my_active_room`.
- **Concurrency:** every room RPC first takes `SELECT … FOR UPDATE` on the room row. Capacity is also guaranteed structurally: a trigger enforces `0 ≤ seat < capacity` and there is a partial unique index on `(room_id, seat)` for ACTIVE players.
- **Lazy maintenance (no scheduler):** `private.run_lobby_maintenance` runs inside `join_room`, `set_ready`, `update_room_settings`, `kick_player`, `leave_room`, `claim_host` and **`heartbeat`**. It removes lobby members not seen for over 120 s, re-elects a host missing or stale for over 60 s (rule in §6), and closes empty lobby/finished rooms. Every lobby action also counts as a heartbeat for the caller.
- **Per-user cap:** at most 3 *live* memberships, counting IN_GAME rooms plus lobby seats seen within 120 s. Stale lobby seats elsewhere don't block a returning player.
- **Snapshot `start` block:** `{ minPlayers, playerCount, notReadyCount, canStart }`, computed only on the server. `start_game` does not exist yet. The host's Start button is shown disabled.
- **Client:** `src/lib/services` (interfaces, plus the Supabase implementation as the only place supabase-js is used), `src/features/session/AuthProvider.tsx` (lazy anonymous sign-in, deduplicated, never replaces a stored session after a network error), `src/features/lobby` (TanStack Query hooks, `useRoomLiveness`, components), and the routes `/` and `/r/:code`.

## 7. Realtime model

- **Channel:** one **private** Realtime channel per room, topic `room:{roomId}`. Realtime Authorization uses an RLS policy on `realtime.messages` that allows SELECT (receive) only when `is_room_member(room id parsed from topic)`. Clients cannot broadcast on it. The only client-originated traffic allowed is presence.
- **Server → client broadcast pings** (no hidden data, and as little public data as possible):

| Event | Payload | Client reaction |
|---|---|---|
| `room_changed` | `{ roomVersion }` | Invalidate the room and player queries (join, leave, ready, host, capacity, kick, status) |
| `round_changed` | `{ roundId, version, lastEventSeq }` | If `version > cached`, refetch the snapshot (public + own private + events since seq) |
| `game_changed` | `{ gameId, status, currentRoundNo }` | Refetch the snapshot (new round, finished) |

- **Presence:** each client tracks `{ playerId }` on the room channel for live connection dots. This is a UI hint only.
- Every gameplay effect in the requested list (turn change, board update, action effect, destination reveal, round end, role reveal, leaderboard, host migration) arrives as a `round_changed`, `game_changed` or `room_changed` ping followed by a refetch. Nothing is applied from the ping payload.
- **Fallbacks:** when the channel status becomes `SUBSCRIBED` after a disconnect, or when the tab becomes visible again, the client refetches unconditionally. While the channel is down, the client polls the snapshot every 5 s.
- **Ordering:** the client ignores any snapshot whose `state_version` is lower than the one it has cached. This protects against out-of-order responses.

**As implemented (Prompt 3):** `game_changed { gameId, roundId, version }` is sent on the same private room channel after every committed game transition. Clients refetch `get_game_snapshot` and `get_my_game_state` when the round id differs or the version is newer, and only render when both refer to the same round and version.

**As implemented (Prompt 2):**

- Only `room_changed { roomVersion }` existed at first, sent by `private.broadcast_room_changed` via `realtime.send` on private topic `room:{roomId}`. If the broadcast fails, it is logged and never fails the lobby operation.
- Receive is authorized by the policy "room members receive room broadcasts" on `realtime.messages`, which uses `private.can_access_room_topic`. There is no insert policy, so clients cannot send or track presence.
- **Presence is not used yet.** Connection dots come from server `last_seen_at` in the snapshot (CONNECTED < 45 s, AWAY < 120 s, otherwise DISCONNECTED). A heartbeat from a member who had been away bumps the version so others see the reconnect.
- Client polling: every 30 s while subscribed, every 5 s while realtime is down. The snapshot is also refetched on every (re)subscribe, when the tab becomes visible, and when the browser comes back online. Pings with a version not newer than the cache are ignored.

### 7.1 Snapshot read model

`get_room_snapshot(room_id, since_seq)` is SECURITY INVOKER, so RLS applies. It returns:

```
{ serverNow, room, players[], game?, round? { header, public_state, reveal? },
  me { playerId, seat, isHost, private_state? }, events[] (seq > since_seq, max 200), scores[] }
```

`serverNow` lets the client estimate its clock offset, so countdowns and timeout requests line up with server deadlines. The client clock is never trusted for correctness.

The TanStack Query key is `['room', roomId, 'snapshot']`. Local UI state (selected card, rotation, zoom, pending command) stays in feature-level React state or a reducer and is never mixed into the server cache.

---

## 8. Command processing (Edge Function `game-command`)

```
1. Verify JWT (supabase.auth.getUser) → userId. Reject if missing.
2. Validate body shape (hand-written schema; size ≤ 4 KB). Check header x-rules-version == domain RULES_VERSION, else CLIENT_OUTDATED.
3. Rate-limit (userId, 'game_command'): 20/10 s burst, 120/min.
4. Idempotency: SELECT command_log WHERE command_id → if found and user matches, return stored response.
5. Resolve the caller's room_players row (ACTIVE, matches roomId) → playerId. Never trust a client-sent playerId.
6. Load round_secrets (service role) + version. If version ≠ expectedVersion → return STALE_STATE {currentVersion}.
7. now = server clock. result = domain.applyCommand(state, playerId, cmd, now).
8. On DomainError → write command_log(outcome=REJECTED), return { ok:false, code }.
9. Build projections: public, private for each affected player, reveal if ended, scores.
10. Call persist_round_transition(..., expected_version) → CAS. On STALE_STATE → return STALE_STATE.
11. Return { ok:true, version, private? }.
```

Serialisation of concurrent commands relies on the CAS in step 10. Two concurrent valid commands at the same version cannot both commit.

### 8.0 As implemented (Prompt 3)

**Layers.** `supabase/functions/game-command/index.ts` is a ~50-line Deno entry. It reads env, creates the service-role client, verifies the JWT via `auth.getUser`, generates a 128-bit seed with `crypto.getRandomValues`, and delegates to host-neutral code in `supabase/functions/_shared/game/`:

- `http.ts`: CORS (`ALLOWED_ORIGINS`), method and size limits, bearer token, structured logs that never include game state.
- `handler.ts`: the pipeline.
- `store.ts`: `GameStore` over an injected RPC caller.

The same handler and store run in Node integration tests against a real database (`tests/integration`). `deno check` validates the entry and the shared code (`npm run check:edge`).

**Shared domain.** `npm run domain:sync` copies `src/domain/**` (excluding tests and `testing/`) byte-for-byte to `supabase/functions/_shared/domain/`. `npm run domain:check` fails on any drift; it runs in `test:fast` and `build`. The copy is excluded from lint and Prettier and must never be edited by hand.

**Request.** `POST { roomId, commandId (uuid), expectedVersion?, command }` with header `x-rules-version`.

- `expectedVersion` is required for `PLAY_PATH`, `PLAY_ACTION`, `DISCARD` and `RESOLVE_EXPIRED_TURN`.
- Commands: `START_GAME`, `START_NEXT_ROUND`, `PLAY_PATH`, `PLAY_ACTION`, `DISCARD`, `RESOLVE_EXPIRED_TURN`, `LEAVE`.
- Responses are `{ ok: true, commandType, version?, gameId?, roundId?, private? }` or `{ ok: false, error, currentVersion?, remainingMs? }`.
- HTTP status: 200 for application and rule errors, 401 without a valid token, 413 for an oversized body, 500 for `INTERNAL`.
- `private` holds only the caller's own private effects (their scout result or drawn card). The server never returns another player's effects, including on a timeout resolved by someone else.

**Pipeline.**

1. Rules version, then request shape.
2. `game_server_context` (service_role) returns membership, room, active members, the logged command for `commandId`, game, round, secret state and DB `serverNow`. It also consumes the 120/min per-user `game_command` rate limit. That limit is generous enough that member-triggered timeout resolution stays reliable.
3. Idempotent replay: same user, room and canonical-JSON fingerprint returns the stored response with `replayed: true`. Any other reuse returns `COMMAND_ID_REUSED`.
4. Domain `createRound` / `applyCommand` with DB time.
5. Projections (`projectPublic`, `projectPrivate` for every player, `projectReveal` at round end).
6. Persist with compare-and-swap on the loaded secret version (never the client's value).
7. On any persistence conflict, re-read: a committed identical retry is replayed. A lost `RESOLVE_EXPIRED_TURN` race returns `TURN_ALREADY_RESOLVED`. Otherwise the stable error is returned.

**Persistence functions** (`supabase/migrations/20261006110000_game_schema.sql`; single `jsonb` argument; EXECUTE for `service_role` only): `game_server_context`, `game_persist_start`, `game_persist_transition`, `game_persist_next_round`, `game_persist_leave_ended`. They re-check membership, host and readiness under the room/game row lock, verify that the player set a round was built from still equals the active members, CAS the version, write all projections, events, scores, the reveal and the command log in one transaction, and send the `game_changed` ping. They make no rule decisions.

**Lifecycle details.**

- Only successful commands are logged. A rejected command changes nothing and is simply re-evaluated if retried.
- The round-ending transition writes results and scores, deletes `private.round_secrets`, and finishes the game in the same transaction when `decideAfterRound` says so (after round 3, or fewer than 3 players remain).
- `START_NEXT_ROUND` (host any time; others after `results_deadline`) creates the next round from the room's ACTIVE members, or finishes the game.
- `LEAVE` while a round is active is a domain transition plus `room_players.status = LEFT` and host migration. While the round has ended it uses `game_persist_leave_ended`.
- "Play again" (FINISHED → LOBBY) is not implemented yet.

### 8.1 `RESOLVE_EXPIRED_TURN` (resolveExpiredTurn)

Request: `{ type: "RESOLVE_EXPIRED_TURN", roomId, roundId, expectedTurnNumber, expectedVersion, commandId }`.

The server checks, after steps 1–5 above (the caller must be an ACTIVE member of the room, and their `last_seen_at` is refreshed):

| # | Check (server-side, against loaded authoritative state) | On failure |
|---|---|---|
| 1 | `roundId` is the current round of the room's current IN_PROGRESS game, and the phase is `ROUND_ACTIVE` | `TURN_ALREADY_RESOLVED` if the round ended, otherwise `ROUND_NOT_ACTIVE` |
| 2 | `state.turnNumber == expectedTurnNumber` (the turn was not already resolved) | `TURN_ALREADY_RESOLVED` |
| 3 | `serverNow ≥ state.turnDeadline`, using the DB `now()` fetched in the same request | `TURN_NOT_EXPIRED { remainingMs }` |
| 4 | `state.version == expectedVersion` | `STALE_STATE { currentVersion }` |
| 5 | Domain `applyCommand(RESOLVE_EXPIRED_TURN)` discards the lowest `handPosition`, draws, checks exhaustion, advances, sets a new deadline and bumps the version | — |
| 6 | `persist_round_transition` CAS on the version | If the CAS fails, re-read: if the turn advanced, return `TURN_ALREADY_RESOLVED`, otherwise `STALE_STATE` |

Properties:

- **Atomic:** one transaction, as for every command.
- **Idempotent:** the same `commandId` returns the stored response. Different `commandId`s for the same turn: exactly one CAS wins and every other request gets `TURN_ALREADY_RESOLVED`. Clients treat that code as success: a no-op followed by a refetch.
- **No dependence on client trust:** the client only says "I think turn N at version V has expired". The server decides everything.

Client scheduling (UX policy only, not a correctness requirement):

- Each connected client with a visible tab schedules a request at `turnDeadline` using its estimated server offset.
- The active player's own client fires at `deadline + 250 ms`. Other clients fire at `deadline + 750 ms + random(0–1500 ms)` to spread out duplicate requests.
- On `TURN_NOT_EXPIRED`, the client reschedules using `remainingMs`.
- On `TURN_ALREADY_RESOLVED`, `STALE_STATE` or success, it refetches the snapshot.

`START_NEXT_ROUND` after `results_deadline` follows the same pattern. Clients request it, and the server checks the phase is `ROUND_ENDED`, `serverNow ≥ results_deadline` (or the caller is the host), the round number matches, and the version is current.

### 8.2 `game-maintenance` (optional safety net only)

**Active gameplay never depends on this job.** A game with connected members progresses entirely through member requests (§8.1). With the job disabled, every Tier B/C gameplay test must still pass.

If deployed, pg_cron calls it through pg_net every 5 minutes with the `MAINTENANCE_SECRET` header. It only:

- marks IN_PROGRESS games ABANDONED and rooms CLOSED when no member has sent a heartbeat for 10 min. It never plays a turn or starts a round.
- deletes anonymous auth users that are inactive (SECURITY_MODEL §6).

Pure SQL cleanup (old rooms, logs, rate-limit buckets, error reports) runs hourly in pg_cron (SECURITY_MODEL §6). If pg_cron is unavailable, data only accumulates longer. No gameplay is affected.

---

## 9. Reconnect and multi-tab architecture

### 9.1 Identity

- **Identity = the Supabase anonymous auth session** (owner decision D2). The session is persisted in localStorage (`persistSession: true`, `autoRefreshToken: true`). All tabs of the same browser profile share **one** identity.
- **Restores the seat:** refresh, temporary network loss, closing and reopening the tab or browser (same profile, storage intact), and background suspension.
- **Does not restore the seat (v1 limitation, out of scope):**
  - another device or browser,
  - a private/incognito window that was closed,
  - cleared site data,
  - an expired refresh token after long inactivity.
  
  In these cases the player has a new identity and cannot reclaim the old seat. Their old seat behaves as a disconnected player: turns time out, and the seat is skipped once the hand is exhausted.
- There are no rejoin tokens, seat-transfer codes or permanent accounts in v1. The data model does not prevent adding them later. A future `seat_claims` mechanism could rebind `room_players.user_id`.

### 9.2 Scenarios

| Scenario | Behaviour |
|---|---|
| Refresh | Session restored → `get_my_active_room()` → route `/r/{code}` → snapshot → subscribe. Seat, hand and role are intact. |
| Temporary network loss | supabase-js reconnects the socket. A banner appears. Command buttons are disabled while offline. A full snapshot refetch runs on reconnect. A pending command that may have reached the server is retried **with the same `commandId`**, which is idempotent. |
| Backgrounded tab (mobile) | Heartbeat slows to every 60 s, or stops if the OS suspends the tab. On `visibilitychange → visible`: immediate heartbeat plus refetch. The deadline is server-side, so a backgrounded active player's turn is resolved by any other connected member's `resolveExpiredTurn`. |
| Everyone disconnected | Nothing progresses, because no scheduler plays turns. The first member to return gets a snapshot showing the expired turn and resolves it. Each later turn gets a fresh deadline. After 10 min with no heartbeat, the optional safety net may mark the game ABANDONED. |
| Multiple tabs (same identity) | A `BroadcastChannel('tunnels-session')` leader election picks one **primary** tab per room. Secondary tabs show a read-only view with a "Играй тук" (Play here) button that takes over. This is a UX layer only. **Server protection** is that every command needs `expectedVersion` (only one can commit per version) plus a unique `commandId` (replays are no-ops). Two tabs cannot take two turns, because after the first commit the turn moves on and the second command fails with `NOT_YOUR_TURN` or `STALE_STATE`. |
| Returning during the same round | Snapshot includes the current hand and role. Any AFK flag clears on the next successful command. |
| Returning after the round ended | The snapshot shows ROUND_ENDED results or the next round in progress. In the next round the player has a fresh hand and role, because they stayed seated. |
| Returning after leaving | `LEFT` is final for that game. The player sees the room's current status and can rejoin only when the room is back in LOBBY. |

### 9.3 Client command lifecycle (double-click and stale safety)

1. The user confirms an action. The client generates a `commandId` (crypto.randomUUID) and stores it in the pending-command state.
2. All play controls are disabled while a command is pending, which handles double-clicks.
3. The request is sent with the cached `expectedVersion`.
4. On success, the client waits for or triggers a snapshot refetch, then clears pending.
5. On `STALE_STATE`, the client refetches and asks the user to retry if the action is still legal. It is never auto-replayed with a new version.
6. On a network error, the client retries with the same `commandId` up to 3 times with backoff.

---

## 10. Frontend architecture

- **Routing (React Router):** `/` landing, `/create`, `/join`, `/r/:code` (the room shell renders lobby, game, results or final based on the snapshot), `/privacy`, `*` 404.
- **Data:** TanStack Query for every server read and mutation. A realtime hook maps pings to `invalidateQueries`. `staleTime` is moderate, because invalidation drives freshness.
- **Board rendering:** an SVG layer inside a transform container (CSS `transform: translate/scale` driven by pointer events). Cells are sized in board units, and procedural path glyphs are generated from topology. Coordinates are domain `(x, y)`, never DOM positions.
- **Legal-move hints:** `domain.legalPlacements(publicBoard, card, rotation)`. Because destinations never constrain placement, legality needs public information only. The server still re-validates everything.
- **Error boundary** at the route level with a "reload" action. It reports through `lib/errors`.
- **Code splitting:** the game route is lazy-loaded.

---

### 10.1 As implemented (Prompt 4: gameplay UI)

- **Code splitting.** `/r/:code` (RoomPage) is lazy-loaded from the router, and the game (`src/features/game/GameView.tsx`) is lazy-loaded from RoomPage. The landing page never downloads lobby or game code. `/__preview/game?view=turn|waiting|reveal|results|final` is a **development-only** fixture preview (no backend). It is registered behind `import.meta.env.DEV` and is absent from production builds.
- **Snapshot consistency.** `GameView` keeps the newest public+private pair that refers to the same round and version. While a newer pair loads (a reconnect, or a race between the two requests) the last consistent pair stays on screen, marked as syncing, with actions disabled. A mismatch triggers a refetch of both.
- **Board.** Rendered as SVG from domain coordinates (`board/geometry.ts`: `cellOrigin(x, y) = ((x − minX)·100, (y − minY)·100)`); pixel positions are never stored. The camera (`board/useBoardCamera.ts`) uses plain pointer events and an SVG transform:
  - drag to pan (6 px threshold; a pan suppresses the following click)
  - two-finger pinch, and non-passive wheel zoom around the cursor
  - zoom 0.3–2.5×, with the camera clamped so the board can never be lost
  - initial fit to the tunnels and destinations, plus a «Центрирай» button
- **Tunnel art.** `art/TunnelArt.tsx` draws ONLY from `pathTopology(typeId, rotation)`. Each multi-opening segment is one passage meeting at a hub; each single-opening segment is a dead end ending at a rubble blocker.
- **Destinations.** Hidden destinations render identically for every slot; their identity never reaches the DOM. The player's own survey knowledge (from their private snapshot) adds a small personal badge.
- **Interaction.** The selected card, rotation (0°/180°) and chosen target live in a `Selection` that records the state version it was made at, so any server update clears it. Legal cells come from domain `legalPlacements`, used as a UX preview only.
  - Fine pointers place with one click. Coarse/touch pointers choose a cell, then confirm with «Постави».
  - Sabotage/repair targets are only players whose tool state allows it (public tool state). Survey targets only hidden destinations. Cave-in targets only placed tunnels.
  - Discarding always needs a second confirmation.
  - Every board/player choice also has a keyboard-accessible control in the action bar.
- **Timeouts.** `useAutoTimeout` sends one `RESOLVE_EXPIRED_TURN` per expired turn: the active player's client after 250 ms, others after 750–2250 ms. Lost races (`TURN_ALREADY_RESOLVED`, `STALE_STATE`) are quiet, and `TURN_NOT_EXPIRED` allows a retry. The countdown uses the server-clock offset measured when the snapshot arrived, and only the countdown re-renders each second.
- **Errors.** Expected concurrency outcomes are quiet. `CLIENT_OUTDATED` shows a dedicated reload dialog, and loss of membership shows a "no longer in this game" dialog. Other errors appear as short Bulgarian toasts.
- **Play again.** `reset_room(room_id)` (migration `20261006120000_play_again.sql`, ARCHITECTURE §4.2) is host only. It moves a FINISHED room to LOBBY with the same code and ACTIVE members, readiness reset, and the old game kept as history.

## 11. Observability (summary)

- `lib/errors/reporter.ts` defines an interface `report(error, context)`. Implementations: a console reporter (dev) and a Supabase RPC reporter (prod: rate-limited, truncated, no PII beyond the anonymous ID). A Sentry free-tier adapter can be added later without touching call sites.
- The Edge Function logs structured JSON: `{ cmd, roomId, roundId, version, outcome, code, ms }`. It never logs secret state or hands.
- Every server error returns a stable `code`. Unexpected failures return `INTERNAL` with a correlation ID that is also logged.

---

## 12. Extensibility points

| Future feature | Extension mechanism |
|---|---|
| New card of an existing category | Add a row to `config/deck.ts` and i18n keys |
| New card category | Add a resolver in `cards/`, a target type in the `PLAY_ACTION` union, and UI target-picker support |
| New role | Add to the role registry plus win-condition and scoring hooks in `scoring/`. The private projection already carries `role` generically. |
| Game modes | `games.mode`, with a `GameConfig` chosen per mode and passed into the domain |
| English | `src/i18n/en.ts` |
| Spectators | A new membership kind with a public-only snapshot. The private table is already separate. |
