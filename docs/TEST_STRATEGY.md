# TEST_STRATEGY — v1

> Status: **Specification v1 (Prompt 0)**. No tests exist yet. This file defines how tests will be organised, when they run and how long they may take.

## 0. The rule that matters most

> **During normal development, run only Tier A. Run Tier B once at the end of an implementation prompt. Run Tier C only at milestones (before staging or production deploys, or when the owner asks). Run Tier D only when the owner explicitly asks for it.**
>
> An implementer (human or AI) must **not** run `test:release`, `test:e2e`, `test:db`, `test:soak` or any Tier C/D script as part of routine edit–verify loops, and must not "just to be safe" run the full suite after small changes. If a change touches an area normally covered only by Tier C (RLS, SQL functions, realtime), run only the **specific** relevant Tier C file, and say so explicitly.

The previous project grew test runs of about an hour. This strategy prevents that through:

1. **Separate tiers with separate scripts.** Nothing heavy runs by default.
2. **Default include patterns** that exclude slow suites. A plain `vitest` cannot accidentally pick up e2e, db or sim tests.
3. **Pushing logic into the pure domain**, where tests take milliseconds, so slow integration tests stay few and thin.
4. **Time budgets** (below). Exceeding one is treated as a bug to fix, not a reason to accept a slower suite.

---

## 1. Tiers

### Tier A: fast development tests (target ≤ 30 s, usually under 10 s)

| What | How |
|---|---|
| Domain unit tests for the files you touched | `vitest related <changed files> --run`, or `vitest --changed --run` |
| Component tests for touched components | same mechanism (jsdom, React Testing Library) |
| TypeScript check | `tsc -b --noEmit`, incremental with `tsBuildInfo` |
| Lint, only on changed files | `eslint <changed files>` |

Rules:
- No network, no Supabase, no browsers, no timers longer than fake time.
- A single unit test must run in under 50 ms. Use fake timers. Domain tests need no mocks because the domain is pure.

### Tier B: iteration check (target ≤ 3 min, hard cap 5 min)

Run **once** at the end of each implementation prompt. It covers the unit suite, the build, and **only** the integration tests relevant to that iteration. Full E2E, database, security, load, soak and browser-matrix suites are **not** part of Tier B and must not run automatically after a prompt.

| What | Notes |
|---|---|
| Full unit suite (domain + components) | in parallel (Vitest threads) |
| Seeded mini-simulation | 200 complete rounds with fixed seeds, across player counts 3–10, with random legal moves. Checks invariants (§3). Budget ≤ 10 s. |
| Typecheck (full) | |
| Lint (full) | |
| Production build | `vite build`, plus the bundle secret scan and the domain-sync check |
| **Selected** integration tests | Only the files tagged for the current iteration. They are listed explicitly in the iteration's notes, for example `tests/integration/lobby.*`. They require the local Supabase stack to be running and are skipped with a clear message if it is not. |

### Tier C: release regression (target ≤ 20 min)

Run at milestones, before deploying to staging or production, and before merging a release branch.

| What | Tooling |
|---|---|
| Full database tests: schema, RLS, grants, every RPC | pgTAP through `supabase test db` |
| Security tests (SECURITY_MODEL §7) | pgTAP plus integration |
| Full integration suite: Edge Functions against the local stack | Vitest (node env) with the local Supabase |
| Concurrency and idempotency scenarios | integration: parallel commands, replays, two "tabs" |
| Reconnect scenarios | Playwright: offline/online toggles, reload mid-turn |
| Browser E2E: create → join (3 contexts) → full round → results | Playwright on Chromium plus mobile-viewport emulation |
| Multi-player simulation through real APIs | Scripted 4–6 bot clients play 1 full game against the local stack |
| Accessibility smoke | `@axe-core/playwright` on landing, lobby and game screens |
| `npm audit --audit-level=high` | |

### Tier D: expensive validation (no fixed budget; only on explicit request)

| What |
|---|
| Long soak: many concurrent rooms with bots against **staging** for 30+ minutes |
| Large simulations: 100k+ seeded rounds for balance statistics (faction win rates per player count) and invariant fuzzing |
| Browser and device matrix: Firefox, WebKit, real iOS Safari and Android Chrome (manual or a cloud device service if one is available for free) |
| Load testing of Edge Functions and Realtime fan-out |

Tier D **never** runs automatically, either in CI or after an iteration. It is triggered only by `workflow_dispatch` or manually.

---

## 2. Planned npm scripts

The names are fixed here. The exact commands are finalised in Prompt 1.

| Script | Tier | Intent |
|---|---|---|
| `npm test` | A | Alias of `test:unit:watch`. Watch mode, unit and component tests only. |
| `npm run test:fast` | A | `vitest --changed --run` + `tsc -b --noEmit` + `eslint` on changed files |
| `npm run test:unit` | B part | Full unit and component suite, one run |
| `npm run test:sim:small` | B part | 200-round seeded simulation |
| `npm run typecheck` | A/B | `tsc -b --noEmit` |
| `npm run lint` | B | full lint |
| `npm run build` | B | `vite build` + `check:bundle` + `check:domain-sync` |
| `npm run test:integration -- <pattern>` | B (selected) / C (all) | integration tests, require local Supabase |
| `npm run test:iteration` | B | typecheck → lint → unit → sim:small → build. **Does not** include integration by default. Pass a pattern via `TEST_INTEGRATION=lobby` to add the selected ones. |
| `npm run test:db` | C | `supabase test db` |
| `npm run test:e2e` | C | Playwright |
| `npm run test:release` | C | iteration + db + full integration + e2e + audit |
| `npm run test:sim:large` | D | 100k-round simulation with a stats report |
| `npm run test:soak` | D | bot soak against a configured target URL. Refuses to run without `SOAK_TARGET` set. |

**Implemented in Prompt 1:**

- `test` (watch)
- `test:unit`
- `test:fast` (`vitest --changed` plus both typechecks)
- `typecheck` = `typecheck:domain` (`tsconfig.domain.json`, no DOM lib) + `typecheck:app` (`tsc -b`)
- `lint`
- `format` / `format:check`
- `build`
- `test:iteration`

**Added in Prompt 2:**

- `test:db` (`supabase test db`, pgTAP, needs `npm run db:start`) currently runs `supabase/tests/database/lobby_security.test.sql`: 57 targeted lobby/security assertions.
- `db:start`, `db:stop`, `db:status` and `db:reset`.

- `test:db:docker` runs the same migrations and pgTAP files **without the Supabase CLI** (for workstations where the CLI binary cannot run). It uses the official `supabase/postgres`, `gotrue` and `realtime` images in the CLI's order and takes about 30 s with images cached. It is the same tier as `test:db`.
- CI: `.github/workflows/db-tests.yml` runs `supabase test db` only on changes under `supabase/**` (or manually), separately from the fast workflow.

**Added in Prompt 3:**

- Vitest project `unit-backend` (handler and HTTP layer with a stub store; part of `test:unit` and `test:fast`).
- Vitest project `integration` (`tests/integration`, the real pipeline against a migrated database, never in `test:unit`).
- `npm run test:backend:docker`: one container lifecycle running both pgTAP suites plus the integration project, about 35 s.
- `npm run domain:check`: fast, no Docker; part of `test:fast` and `build`.
- `npm run typecheck:backend`.
- `npm run check:edge`: `deno check` of the Edge entry in the official Deno image (needs Docker).

**Prompt 4:**

- Game UI interaction tests in `src/features/game/GameView.test.tsx`:
  - tunnel renderer topology and role reveal
  - legal highlights, rotation, desktop one-click and touch two-step placement
  - break, repair, survey (privacy) and cave-in targeting
  - discard confirmation and the blocked explanation
  - automatic timeout with a quiet lost race
  - `CLIENT_OUTDATED`, version mismatch, results, and final standings with play again
- Visual checks use the dev-only `/__preview/game` route. These are manual and not part of any test tier.

`test:db` is Tier C (or the "targeted DB" part of Tier B when SQL changed). It is never part of `test:fast` or `test:unit`. Frontend lobby tests mock Supabase at the service boundary (`src/test/fakes.tsx`) and run in `unit-ui`.

The seeded mini-simulation (80 rounds, 3–10 players) currently runs inside `test:unit` because it takes well under 1 s. It moves to `test:sim:small` only if it outgrows that budget. The Vitest projects are currently `unit-domain` (node) and `unit-ui` (jsdom). Integration, database, E2E and simulation projects are added in later iterations and stay out of the default run.

Planned Vitest configuration uses **projects**:

- `unit`: `src/**/*.test.ts(x)`, excluding `tests/**`
- `integration`: `tests/integration/**`
- `sim`: `tests/sim/**`

The default `vitest` invocation runs only `unit`. Playwright lives in its own config under `tests/e2e/`, so Vitest never picks it up.

---

## 3. What belongs where

| Subject | Primary tier | Approach |
|---|---|---|
| Direction, rotation, topology tables | A | table-driven unit tests |
| Reachability BFS, dead ends, orphans | A | handcrafted boards in ASCII fixtures, for example `parseBoard(\`...\`)` |
| Placement legality (every error code in GAME_RULES §7.1, in order) | A | one test per code plus a precedence test |
| Destination reveal (single, multiple, treasure plus empty, collapse after reveal) | A | |
| Action resolvers (each category, each error) | A | |
| Turn advancement (skipping left players and empty hands, wrap-around) | A | |
| Hand positions: monotonic, never renumbered, gaps after removal, canonical order | A | |
| `RESOLVE_EXPIRED_TURN` domain logic: lowest `handPosition` discarded, draw and advance in one transition, `TURN_NOT_EXPIRED` before the deadline (injected `now`), `TURN_ALREADY_RESOLVED` on a turn mismatch, AFK counter | A | |
| Timeout race: N concurrent resolve requests leave exactly one transition and N−1 `TURN_ALREADY_RESOLVED` | B (selected, when the Edge command layer changes) / C | integration against the local stack, **with no scheduler running** |
| Domain portability: `tsconfig.domain.json` (no DOM lib) typechecks, no non-relative imports, JSON round-trip of state | A (typecheck) / B | |
| Synced Edge copy equals `src/domain` | B | `check:domain-sync` inside `build` |
| Exhaustion and round end | A | |
| Setup determinism (same seed gives the same state; role, hand and deck counts per player count) | A | snapshot of a small state hash for each seed |
| Deck catalog totals (66, each quantity) | A | |
| Scoring and ranking (all outcomes, ties, left players) | A | |
| Projections never leak (no role, hand, seed or hidden identity in public; only own data in private) | A | plus a property test over the simulation in B |
| Simulation invariants: card conservation (hand + deck + discard + board = 66), at most one card per cell, turn count ≤ 66, every round terminates | B | seeded mini-sim |
| i18n: every `DomainErrorCode` and card type has a `bg` key | A | type-level, plus one unit test |
| Components: Hand, Board cell, PlayerList, Lobby form validation, RoomCode copy | A | RTL |
| Command client: pending-lock, retry with the same commandId, STALE handling | A | mocked fetch |
| Realtime → invalidation mapping | A | mocked channel |
| RLS, grants, RPC guards | C | pgTAP |
| Edge `game-command` happy path plus rejections | B (selected) / C | integration |
| Full game across browsers | C | Playwright |

### 3.1 Testing conventions

- Seeds are fixed strings in tests (for example `'seed-3p-001'`). Never use random seeds without printing them.
- Domain fixtures use builders (`aRound().withPlayers(4).withBoard(\`…\`).build()`).
- Component tests query by role and label (this also checks accessibility) and avoid snapshot-heavy tests.
- No `sleep` in any test. Use fake timers in unit tests, and Playwright auto-waiting or polling with a timeout in e2e.
- Flaky tests are quarantined within one working day (`.skip` plus an issue) and are never retried in a loop.
- **No gameplay test may depend on pg_cron or any scheduler.** Integration and E2E environments run with scheduled jobs disabled. Expired turns are driven by test clients calling `resolveExpiredTurn`, or by an injected `now` in domain tests.

---

## 4. When each tier runs

| Moment | Tier |
|---|---|
| Every save or small edit while implementing | A (watch or `test:fast`) |
| End of an implementation prompt or iteration | B (`test:iteration`, plus the named integration subset) |
| Pull request CI | B (unit, sim:small, typecheck, lint, build). Integration only if `supabase/**` changed, and only the matching files. |
| Merge to `main` | B |
| Before a staging deploy (milestone) | C (`test:release`) |
| Before a production deploy | C on the release commit, plus the manual checklist in RELEASE_PLAN.md |
| Nightly | Optional, owner-controlled: C. Off by default until staging exists. |
| On explicit request only | D |

---

## 5. Time budget enforcement

- CI prints the duration of each tier. If Tier B exceeds 5 minutes or Tier A exceeds 30 s locally, the next iteration must include remediation: move logic into the domain, shrink fixtures, parallelise, or demote tests to Tier C.
- Integration and E2E counts stay deliberately small. **E2E checks that the pieces are wired together. It does not verify rules.** Rules are verified in the domain.
