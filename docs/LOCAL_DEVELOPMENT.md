# Local development

Written for: developers running the complete game locally (no hosted services).

## Quick start: complete local multiplayer

Prerequisites: Node.js 20.19+ (24 recommended), npm, Docker Desktop running, `npm install` done.

| Step | Command | Notes |
|---|---|---|
| 1. Start backend | `npm run local:start` | Terminal 1. Keep it running (it serves `game-command`). |
| 2. Start frontend | `npm run dev` | Terminal 2. Wait until step 1 prints `Serving functions on …`. |
| 3. Play | open **http://localhost:5173** | Use 3 separate browser profiles / private windows. |
| 4. Stop frontend + function | Ctrl+C in both terminals | |
| 5. Stop backend | `npm run local:stop` | Stops containers, keeps local data. |

`local:start` does the following:
- Starts the local Supabase stack: Postgres, Auth, PostgREST, Realtime, the API gateway and the Edge runtime. Studio is skipped. Project id `tunnels`; ports 55321 (API) and 55322 (DB), so it does not clash with other projects on the default 5432x ports.
- Applies all pending migrations from `supabase/migrations` in filename order, without resetting data.
- Writes only the local API URL and the public anonymous key to `.env.local`.
- Serves the real `game-command` Edge Function with JWT verification enabled.

No hosted project or deployment is involved.

Each browser profile (or isolated private window) is a separate anonymous player. Tabs in the same profile share one player, and a refresh keeps the same player and seat.

### Local end-to-end tests (both terminals running)

```bash
npx playwright test tests/e2e/local-multiplayer.spec.ts   # ~20 s smoke: 3 sessions, lobby, start, turns
npx playwright test tests/e2e/full-game.spec.ts           # ~10+ min: complete 3-round game (see below)
```

`full-game.spec.ts` covers the following:
- Lobby with 3 identities, readiness and refresh recovery.
- Every card action the deal allows.
- A real 60 s turn timeout.
- Realtime refetch and offline → online convergence.
- Survey privacy across a refresh.
- Results, the final leaderboard and Play Again.
- A privacy oracle over every RPC/function response and Realtime frame.
- Screenshots of the real game at 390 / 1366 / 1920 px into `artifacts/local-visual/`.

The spec reads the local database (`postgres://postgres:postgres@127.0.0.1:55322/postgres`, the local-only default) to verify outcomes. It never writes to it. On Windows, Playwright uses the installed Microsoft Edge without changing Windows Application Control.

Known local-only difference: the local API gateway answers CORS preflights with `Access-Control-Allow-Origin: *` before the function runs. The function itself still checks origins. Re-verify CORS on any hosted environment.

## Public environment variables

`local:start` writes `.env.local` for you. To set it by hand:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `http://127.0.0.1:55321` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the anon key from `npx supabase status` |

Only public values go in `VITE_*` variables, because they are embedded in the browser bundle. **Never** put the service-role key, database password, access tokens, or CAPTCHA/Edge secrets in `.env*` files used by Vite.

Without these variables the app still runs. The landing page then says that multiplayer is not configured.

Anonymous sign-ins are enabled in `supabase/config.toml` (`enable_anonymous_sign_ins = true`).

## Gameplay Edge Function

```bash
npm run domain:sync    # after ANY change in src/domain (copies it to supabase/functions/_shared/domain)
npm run check:edge     # deno check via Docker (no local Deno needed)
```

Restart `npm run local:start` after changing the function or the shared domain.

## Migrations

- Add a new timestamped file with `npx supabase migration new <name>`. Never edit a migration that has already been applied anywhere shared.
- `npm run local:start` applies new migrations. `npm run db:reset` rebuilds from scratch and **wipes local data**, so use it only when you mean it.
- Each migration must revoke function `EXECUTE` from `public`/`anon`/`authenticated` and grant explicitly. The pgTAP suite fails otherwise.

## Database / security tests (targeted)

```bash
npm run test:db:docker        # pgTAP security suites in throwaway containers (separate from the play stack)
npm run test:backend:docker   # + backend integration tests (real game-command handler vs migrated DB)
```

These use their own disposable containers (`tunnels-dbtest-*`, port 54329) and never touch the local play stack's data. They are **not** part of the fast development loop (see TEST_STRATEGY.md). Run them when you change SQL or security, and at milestones.

## Everyday checks

```bash
npm run test:fast    # changed unit/component tests + both typechecks
npm run test:unit    # full unit + component suite
npm run lint
npm run build
```
