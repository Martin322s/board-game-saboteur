#!/usr/bin/env bash
# deno check of the Edge Function entry (and everything it imports: shared handler + domain copy)
# using the official Deno image, so no local Deno installation is required.
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT=$(cd "$(dirname "$0")/.." && pwd)
docker run --rm -v "$ROOT/supabase/functions:/fns:ro" -w /fns "${DENO_IMAGE:-denoland/deno:latest}" \
  deno check game-command/index.ts
