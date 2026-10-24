#!/usr/bin/env bash
# Targeted pgTAP run WITHOUT the Supabase CLI (for workstations where the CLI binary cannot run).
#
# Reproduces the CLI's database setup with the official Supabase images, in the CLI's order:
#   supabase/postgres  ->  GoTrue (auth schema migrations)  ->  Realtime (realtime schema)
#   ->  supabase/migrations/*.sql  ->  supabase/tests/database/*.test.sql
# Requires a running Docker engine. Everything runs in throwaway containers on a private network
# and is removed on exit. Test-only credentials below never leave those containers.
#
# Usage: npm run test:db:docker                 (pgTAP suites)
#        npm run test:backend:docker            (pgTAP suites + backend integration tests)
set -euo pipefail
RUN_INTEGRATION=false
[ "${1:-}" = "--integration" ] && RUN_INTEGRATION=true
export MSYS_NO_PATHCONV=1

PG_IMAGE=${PG_IMAGE:-public.ecr.aws/supabase/postgres:17.11.0.002}
AUTH_IMAGE=${AUTH_IMAGE:-public.ecr.aws/supabase/gotrue:v2.197.0}
RT_IMAGE=${RT_IMAGE:-public.ecr.aws/supabase/realtime:v2.140.3}
NET=tunnels-dbtest-net
DB=tunnels-dbtest-db
AUTH=tunnels-dbtest-auth
RT=tunnels-dbtest-rt
PASS=postgres
JWT=test-only-jwt-secret-with-at-least-32-characters
HOST_PORT=${DB_TEST_PORT:-54329}
ROOT=$(cd "$(dirname "$0")/.." && pwd)

cleanup() { docker rm -f "$DB" "$AUTH" "$RT" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

psql_db() { docker exec "$DB" psql -X -v ON_ERROR_STOP=1 -q -U "$@"; }
wait_for() { # wait_for <description> <sql returning t>
  for _ in $(seq 1 60); do
    [ "$(docker exec "$DB" psql -X -U postgres -d postgres -tAc "$2" 2>/dev/null)" = "t" ] && return 0
    sleep 3
  done
  echo "Timed out waiting for $1" >&2; exit 1
}

docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" -e POSTGRES_PASSWORD="$PASS" \
  -p "127.0.0.1:$HOST_PORT:5432" -v "$ROOT/supabase:/work:ro" "$PG_IMAGE" >/dev/null
# The image runs a temporary server during initialization and then restarts it; require several
# consecutive successful checks so we never race that restart.
ok_in_a_row=0
for _ in $(seq 1 90); do
  if [ "$(docker exec "$DB" psql -X -U postgres -d postgres -tAc 'select true' 2>/dev/null)" = "t" ]; then
    ok_in_a_row=$((ok_in_a_row + 1))
    [ "$ok_in_a_row" -ge 3 ] && break
  else
    ok_in_a_row=0
  fi
  sleep 1
done
[ "$ok_in_a_row" -ge 3 ] || { echo "Timed out waiting for postgres" >&2; exit 1; }
psql_db supabase_admin -d postgres -c "alter role supabase_auth_admin with password '$PASS'; alter role supabase_admin with password '$PASS'; alter role postgres with password '$PASS'; create schema if not exists _realtime authorization supabase_admin;"

docker run -d --name "$AUTH" --network "$NET" \
  -e GOTRUE_DB_DRIVER=postgres \
  -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$PASS@$DB:5432/postgres" \
  -e API_EXTERNAL_URL=http://localhost:9999 -e GOTRUE_SITE_URL=http://localhost:5173 \
  -e GOTRUE_JWT_SECRET="$JWT" -e GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=true -e PORT=9999 \
  "$AUTH_IMAGE" >/dev/null
wait_for "auth migrations" "select exists(select 1 from information_schema.columns where table_schema='auth' and table_name='users' and column_name='is_anonymous')"

docker run -d --name "$RT" --network "$NET" \
  -e PORT=4000 -e DB_HOST="$DB" -e DB_PORT=5432 -e DB_USER=supabase_admin -e DB_PASSWORD="$PASS" \
  -e DB_NAME=postgres -e DB_AFTER_CONNECT_QUERY="SET search_path TO _realtime" \
  -e DB_ENC_KEY=supabaserealtime -e API_JWT_SECRET="$JWT" -e METRICS_JWT_SECRET="$JWT" \
  -e SECRET_KEY_BASE=test-only-secret-key-base-0123456789012345678901234567890123456789 \
  -e ERL_AFLAGS="-proto_dist inet_tcp" -e DNS_NODES="''" -e RLIMIT_NOFILE=10000 \
  -e APP_NAME=realtime -e SEED_SELF_HOST=true -e RUN_JANITOR=true \
  "$RT_IMAGE" >/dev/null
wait_for "realtime migrations" "select to_regclass('realtime.messages') is not null and to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null"

for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$migration")"
  psql_db postgres -d postgres -f "/work/migrations/$(basename "$migration")"
done

status=0
for test in "$ROOT"/supabase/tests/database/*.test.sql; do
  name=$(basename "$test")
  out=$(docker exec "$DB" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -tA -f "/work/tests/database/$name" 2>&1) || status=1
  planned=$(echo "$out" | sed -n 's/^1\.\.\([0-9]*\)$/\1/p' | head -1)
  passed=$(echo "$out" | grep -cE '^ok ' || true)
  failed=$(echo "$out" | grep -cE '^not ok' || true)
  echo "$name: planned=${planned:-?} passed=$passed failed=$failed"
  if [ "$failed" -ne 0 ] || [ "$passed" != "$planned" ]; then
    echo "$out" | grep -E '^not ok|^#|ERROR' >&2
    status=1
  fi
done
if [ "$RUN_INTEGRATION" = true ]; then
  echo "Running backend integration tests against 127.0.0.1:$HOST_PORT"
  (cd "$ROOT" && DATABASE_URL="postgres://postgres:$PASS@127.0.0.1:$HOST_PORT/postgres" \
    npx vitest run --project integration) || status=1
fi
exit $status
