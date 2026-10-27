# Deployment runbook

Written for: the project owner deploying «Саботьор» for the first time.

Nothing in this runbook needs the Supabase CLI on your Windows machine. The backend is deployed by GitHub Actions with the official CLI, and the frontend is built by Netlify from the same repository.

**Public values** (they reach browsers):

- Supabase project URL `https://<project-ref>.supabase.co`
- the **publishable** key (`sb_publishable_…`)

**Private values:**

- the Supabase **access token**
- the **database password**
- any service-role or secret key

Private values go only into GitHub **Secrets**. They never go into source files, `VITE_*` variables, Netlify, chat or issues.

## 0. Prerequisites

- The code is pushed to GitHub (`main`). Decide the repository visibility first. Actions work for private repositories too.
- In Supabase, under Authentication → Sign In / Providers, **Allow anonymous sign-ins** is ON (verified ON on 2026-10-06).

## 1. GitHub configuration

Go to Repository → Settings → Secrets and variables → Actions.

**Secrets:**

| Name | Where to get it |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com → your avatar → **Account preferences → Access Tokens** → *Generate new token* |
| `SUPABASE_DB_PASSWORD` | the database password chosen at project creation. If unknown, reset it in **Project Settings → Database → Database password**. |

**Variables** (all public):

| Name | Value |
|---|---|
| `SUPABASE_PROJECT_REF` | the subdomain of the project URL (`https://<project-ref>.supabase.co`) |
| `SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → publishable key |
| `ALLOWED_ORIGINS` | leave empty for the first run. After step 3, set it to the exact Netlify origin, e.g. `https://saboteur-bg.netlify.app` (no trailing slash; comma-separate several). |

The workflow uses the `production` environment. You can add a required reviewer under Settings → Environments → production.

## 2. Deploy the backend

1. Actions → **deploy-supabase** → *Run workflow* (both boxes ticked).
2. The workflow runs, in order:
   - domain-copy check
   - `supabase link`
   - `supabase migration list`
   - `supabase db push`, which applies all migrations in `supabase/migrations/` in filename order
   - `supabase functions deploy game-command`
   - the hosted smoke test (`scripts/smoke-hosted.mjs`, public values only)
3. The smoke test must show every RPC as existing (the `PGRST202` from `create_room` is gone) and all game-command checks passing, apart from the CORS-allows-origin check, which is skipped until `ALLOWED_ORIGINS` is set.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the Edge Function by the platform automatically. Its only extra setting is `ALLOWED_ORIGINS`, which the workflow sets from the repository variable.

## 3. Deploy the frontend (Netlify)

1. In Netlify, choose **Add new project → Import an existing project → GitHub** and pick the repository.
2. The build settings come from `netlify.toml`: build command `npm run build`, publish directory `dist`, Node 22, SPA fallback, security headers.
3. Under Project configuration → Environment variables, add:
   - `VITE_SUPABASE_URL`: the project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: the publishable key
4. Deploy, then note the production origin, e.g. `https://<name>.netlify.app`.

## 4. Finalize CORS

1. Set the GitHub variable `ALLOWED_ORIGINS` to the exact Netlify origin.
2. Run **deploy-supabase** again, this time with *Apply pending migrations* unticked. It updates the function secret, redeploys, and the smoke test now also verifies CORS for that origin.

## 5. Re-running the smoke test locally (optional)

```bash
SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
ALLOWED_ORIGIN=https://<name>.netlify.app node scripts/smoke-hosted.mjs
```

The test creates one anonymous user, exactly as a visitor would.

## Rollback notes

- **Frontend:** Netlify → Deploys → pick an earlier deploy → *Publish deploy*.
- **Database:** migrations are additive. Fix forward with a new migration, and never edit an applied one.
