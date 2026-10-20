# RELEASE_PLAN — v1

> Status: **Specification v1 (Prompt 0)**. Each iteration below corresponds roughly to one implementation prompt. Each ends with **Tier B** (`test:iteration`) only. Tier C runs at the milestones marked ★.

---

## 1. Implementation iterations

| # | Iteration | Scope | Exit criteria |
|---|---|---|---|
| 1 | **Scaffold and tooling** | Vite + React + TS strict, Router, TanStack Query, Tailwind, Vitest projects, ESLint (import boundaries), npm scripts from TEST_STRATEGY §2, `src/domain` skeleton with `config/` constants from GAME_RULES, i18n skeleton (`bg`), Netlify config and `_headers` draft | `test:iteration` passes on an empty app. Domain config unit tests check deck = 66 and the role and hand tables. |
| 2 | **Domain: board and cards** | Directions, topology, rotation, catalog, reachability, placement legality, legalPlacements, destination reveal | Every GAME_RULES §4, §5 and §7 rule has a test |
| 3 | **Domain: game engine** | RNG, setup, roles, deal, applyCommand (all actions), turn advancement, timeouts, leave, exhaustion, scoring, ranking, projections, seeded mini-simulation | §2, §6, §8–§13 covered. Simulation invariants hold. Projection-leak tests pass. |
| 4 | **Database: schema, RLS and lobby RPCs** ★ | Migrations, grants, RLS, `is_room_member`, lobby RPCs, snapshot RPC, rate limits, Turnstile config on staging, pgTAP suite | Tier C database and security tests pass locally |
| 5 | **Edge Functions: game commands** ★ | Domain sync script and drift check, `RULES_VERSION` handshake, `game-command` (all commands, including `RESOLVE_EXPIRED_TURN`), `persist_round_*`, idempotency, CAS, broadcast pings. The optional `game-maintenance` safety net and cleanup cron come later (iteration 10). | Concurrency, idempotency and timeout-race integration tests pass. A full game, including timed-out turns, can be played through scripts **with no scheduler running**. |
| 6 | **Frontend: session, landing and lobby** | Anonymous auth bootstrap with CAPTCHA, create/join, lobby UI, realtime subscription, presence, heartbeat, host migration UI, reconnect discovery, multi-tab leader election | Three browser contexts can meet in a lobby (manual check plus selected E2E) |
| 7 | **Frontend: game board and hand** | Board SVG, pan/zoom, legal highlights, hand, rotate, action targeting, command lifecycle, timer, event log, role chip, scout modal, mobile layout | A full round is playable on desktop and mobile viewports |
| 8 | **Frontend: rounds, results and endgame** | Round results, reveal, scores, next round, final leaderboard, play again, leave mid-game | A full 3-round game is playable end to end |
| 9 | **Polish** | Accessibility pass (keyboard grid, ARIA, live region, reduced motion), how-to-play sheet, audio (SFX manager, dedupe, mute), error boundary and reporter, empty, loading and error states, privacy page | axe smoke clean. Keyboard-only full turn is possible. |
| 10 | **Hardening and staging** ★ | CSP finalised, bundle scan, cleanup jobs and the optional abandoned-game safety net (pg_cron), indexes reviewed, CI workflows, staging environment, Tier C green, small Tier D soak on staging (on request) | Staging checklist (§3) complete |
| 11 | **Production launch** ★ | Final branding applied, production project, domain, production checklist | Production checklist (§4) complete |

**Progress:**

- Prompt 1 covered iterations 1–3 (domain engine).
- Prompt 2 covered the lobby parts of iterations 4 and 6: schema, RLS, lobby RPCs, pgTAP suite, anonymous auth, landing and lobby UI, realtime pings, heartbeat and host migration.
- Prompt 2.1: the 57-assertion lobby pgTAP suite executed **green** against the official Supabase images (`npm run test:db:docker`). The isolated CI job `.github/workflows/db-tests.yml` runs `supabase test db` when `supabase/**` changes.
- Prompt 3 covered iteration 5:
  - gameplay schema and service-role persistence with compare-and-swap and idempotency
  - the `game-command` Edge Function
  - start, turns, timeouts, round end, results, next round and leave
  - shared domain sync
  - snapshots and the `game_changed` pings
  - a basic debug game page
- Prompt 4 covered iterations 7–9 (UI):
  - the real game screen for desktop and mobile, with board pan/zoom
  - procedural tunnel and card art
  - all action flows, role reveal, timers with automatic timeout requests
  - results, final standings and «Играй отново» (server `reset_room`)
  - help, optional synthesized sound, and code splitting
- Still open:
  - Turnstile CAPTCHA
  - running the Edge Function in the actual Edge runtime (only `deno check` and the Node-hosted handler have been exercised)
  - real multi-browser validation against a running backend

Branding (name, logo, final terminology) can be chosen any time before iteration 11. Only i18n strings and assets should need to change.

---

## 2. Environments

| Env | Frontend | Backend | Purpose |
|---|---|---|---|
| Local | `vite dev` | `supabase start` (Docker) | development, Tier A/B/C |
| Preview | Netlify deploy previews per PR | **staging** Supabase project | UI review only. Preview builds point to staging, never production. |
| Staging | Netlify branch `staging` | Supabase project `tunnels-staging` (free tier) | release candidates, Tier C/D, playtests |
| Production | Netlify `main` (custom domain) | Supabase project `tunnels-prod` | public |

Notes:
- Free-tier Supabase projects pause after a period of inactivity. Staging may need to be resumed before playtests. Production should be checked for that risk, and the Pro plan considered once real traffic exists. That is the only foreseeable paid item, and it is optional.
- Migrations are applied by CI with `supabase db push` to staging on merge to `staging`, and to production only through a manual approval job.
- Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `MAINTENANCE_SECRET` and the Turnstile secret are stored only in the Supabase function secrets and GitHub environment secrets. Netlify holds only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_TURNSTILE_SITE_KEY`.

## 2.1 CI (GitHub Actions)

| Workflow | Trigger | Runs |
|---|---|---|
| `ci.yml` | PR, push to `main` | Tier B (no integration unless `supabase/**` changed; then only the matching integration files) |
| `release.yml` | manual, or push to `staging` | Tier C (local Supabase in the runner plus Playwright), then deploy migrations and functions to staging |
| `deploy-prod.yml` | manual with an environment approval | migrations and functions to prod. Netlify production deploy from the tagged commit. |
| `expensive.yml` | `workflow_dispatch` only | Tier D jobs (choose: sim:large, soak, matrix) |

---

## 3. Staging checklist

- [ ] Tier C (`test:release`) green on the release commit.
- [ ] Migrations apply cleanly to an empty database **and** to the previous staging schema.
- [ ] Every table has RLS enabled (pgTAP check). There are no client write grants.
- [ ] Bundle scan: no service key. Only `VITE_*` env vars present.
- [ ] CSP and security headers verified with the browser devtools console showing no violations, plus an online header scanner.
- [ ] Turnstile enabled for anonymous sign-ins. Auth rate limits are configured.
- [ ] Cleanup and safety-net pg_cron jobs are scheduled and observed running.
- [ ] **Scheduler independence drill:** with every pg_cron job disabled, a full game, including timed-out turns, a missing host and the next-round advance, completes with connected clients only.
- [ ] Timeout race drill: 3+ clients see the same expired deadline. Exactly one `TURN_TIMED_OUT` event appears per turn.
- [ ] Realtime private channels: a non-member is denied (manual check with a second anonymous user).
- [ ] Manual hidden-information audit: as a player, inspect every network response and the Realtime frames in DevTools during a round. Confirm there is no other player's hand or role, no hidden destination identity and no deck information.
- [ ] Playtest: at least one full 3-round game each with 3, 6 and 10 players (real people or bots plus humans).
- [ ] Reconnect drills: refresh mid-turn, airplane mode for 30 s, background the mobile tab for 2 min, two tabs at once, host leaves mid-game.
- [ ] Accessibility: keyboard-only full turn, screen reader smoke (NVDA plus Chrome, VoiceOver plus Safari), reduced motion.
- [ ] Bulgarian copy proofread. No untranslated keys.
- [ ] Error reporting receives a test error. Edge logs contain no secrets.

## 4. Production checklist

- [ ] Every staging checklist item passes on the exact release commit.
- [ ] Final product name chosen and checked for trademark conflicts (EUIPO/BPO). Domain registered. The repository name and any "saboteur" references are absent from the UI, metadata, manifest, page titles and the Netlify site name.
- [ ] Asset licence register (`docs/ASSET_LICENSES.md`) complete. All assets are original, CC0 or permissively licensed.
- [ ] In-game rules text is independently written (reviewed against PRODUCT_SPEC §9).
- [ ] Privacy notice (BG) published. No tracking cookies.
- [ ] Production Supabase: separate project, Turnstile production keys, auth rate limits, PITR or backups as the plan allows, database password rotated, dashboard access restricted with MFA.
- [ ] Netlify: custom domain plus HTTPS, HSTS enabled, `_headers` deployed, SPA redirect `/* /index.html 200`.
- [ ] Rollback plan: the previous Netlify deploy can be restored in one click. Migrations must be backward-compatible with the previous frontend for one release (expand → migrate → contract).
- [ ] Monitoring: Supabase dashboard alerts (database size, function errors), error-report table review routine.
- [ ] Smoke test on production right after deploy: create, join from a phone, play one round.

---

## 5. Browser and device validation

| Platform | Browsers | Tier |
|---|---|---|
| Windows / macOS desktop | Chrome, Edge, Firefox (latest 2), Safari (latest) | Chrome in C (Playwright). The others are manual before production, or in D. |
| Android (mid-range, e.g. 4 GB RAM) | Chrome | Manual before production. Playwright mobile emulation in C. |
| iOS / iPadOS (latest 2 major versions) | Safari | Manual before production. Playwright WebKit in D. |
| Minimum viewport | 360 × 640 portrait | E2E in C |

Manual device pass covers: pinch-zoom and pan, two-step placement, hand scrolling, a backgrounded tab returning, the audio unlock on first gesture, and safe-area insets (notch).

---

## 6. Deployment plan

1. **Frontend:** Netlify builds `npm run build` (which includes the bundle and domain-sync checks). Publish dir is `dist/`. SPA fallback redirect. `_headers` sets the CSP and security headers. Hashed assets get a long-lived cache, and `index.html` uses `no-cache`.
2. **Database:** migrations in `supabase/migrations/` are applied with `supabase db push`, staging first, then production with approval. No manual dashboard schema edits.
3. **Edge Functions:** `supabase functions deploy game-command game-maintenance` from CI, after the domain-sync check.
4. **Scheduled jobs (non-critical):** cleanup and safety-net pg_cron schedules are created by migration, and they read the maintenance URL and secret from Vault. A failed or paused scheduler must never block a release or affect live games.
5. **Order of a release:** DB migrations (expand) → Edge Functions → Frontend → (next release) contract migrations.
6. **Versioning:** the app shows its build version in the menu (`VITE_APP_VERSION` = git short SHA). The client sends it in command headers, so the server can reject clients too old for a breaking protocol change with `CLIENT_OUTDATED`. When the client gets that, it prompts the player to reload.
