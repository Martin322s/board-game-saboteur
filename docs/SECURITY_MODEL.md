# SECURITY_MODEL — v1

> Status: **Specification v1 (Prompt 0)**. Related: [ARCHITECTURE.md](ARCHITECTURE.md) §5, §7, §8.

Assumption: every client is hostile. The attacker has the public Supabase URL and anon key, a valid anonymous JWT, full control of their browser, and can call PostgREST, RPCs, Edge Functions and Realtime directly with arbitrary payloads.

The security goal is that an attacker learns nothing beyond the PUBLIC and ROUND-REVEALED state of rooms they belong to, plus their own PLAYER-PRIVATE state, and can change state only through legal commands taken as their own seat.

---

## 1. Hidden-information classification

| Class | Contents | Who can read | Where stored |
|---|---|---|---|
| **PUBLIC ROOM STATE** | Room code, status, capacity, host, member names, seats, ready flags, connection timestamps. Game status, round number. Board cells (placed path cards with type and rotation), destination slot positions, **revealed** destination identities, tool states, hand **counts**, draw-pile **count**, discard **count**, active seat, turn number, deadlines, state version, public event log, score entries | Room members | `rooms`, `room_players_public` view, `games`, `rounds.public_state`, `round_events`, `score_entries` |
| **PLAYER-PRIVATE STATE** | Own role, own hand (card IDs and types), own scout results | That player only | `round_player_private` (RLS `user_id = auth.uid()`) |
| **SERVER-ONLY STATE** | RNG seed, deck order, every hand, every role, the set-aside role, unrevealed destination identities, other players' scout knowledge, other members' auth UIDs, idempotency log, rate limits, error reports | Nobody through client credentials | `round_secrets`, `command_log`, `rate_limit_buckets`, `client_error_reports`, base `room_players.user_id` |
| **ROUND-REVEALED STATE** | Every role plus the set-aside token, every destination identity, winner, end reason, connector | Room members, **only after** `phase = ROUND_ENDED` | `rounds.reveal` (NULL until the end, enforced by a CHECK on phase) |

Never revealed, even after the round: other players' hands at the end, discarded card types, the remaining deck order, seeds.

---

## 2. Database access strategy

### 2.1 Baseline grants

- `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on **every** table in `public`. A CI pgTAP test fails if any table lacks RLS.
- `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated`. Default privileges are altered the same way for future tables.
- `REVOKE ALL` on `round_secrets`, `command_log`, `rate_limit_buckets` and `client_error_reports` from `anon` and `authenticated`. RLS is enabled with **no** policies, as a second layer.
- `anon` (no JWT) gets no SELECT on anything. Every read requires `authenticated`, and anonymous auth users have that role.

### 2.2 SELECT policies

| Relation | Policy |
|---|---|
| `rooms` | `is_room_member(id)` |
| `room_players_public` (view owned by a privileged role, i.e. *not* `security_invoker`. Its own `WHERE is_room_member(room_id)` clause does the filtering. Clients have no SELECT on the base table `room_players`.) | Rows of rooms where `is_room_member(room_id)`. Columns exclude `user_id`. |
| `games`, `rounds`, `round_events`, `score_entries` | `is_room_member(room_id)` (room_id is denormalised onto each table so policies do not need joins) |
| `round_player_private` | `user_id = auth.uid()` |
| `rounds.reveal` | Same row policy as `rounds`. Confidentiality comes from the value being NULL until the round ends, enforced by `CHECK (phase = 'ROUND_ENDED' OR reveal IS NULL)`. |

Room codes are **not** enumerable. A non-member cannot SELECT any room. `join_room` is the only lookup by code, and it is rate-limited.

### 2.3 Functions

| Function | Security | EXECUTE granted to | Notes |
|---|---|---|---|
| Lobby RPCs (`create_room`, `join_room`, `leave_room` in lobby, `set_ready`, `update_room_settings`, `kick_player`, `heartbeat`, `claim_host`, `reset_room`) | SECURITY DEFINER, `SET search_path = ''`, fully qualified names | `authenticated` | Derive the caller only from `auth.uid()`. Lock the room row (`FOR UPDATE`). Validate every argument. |
| `get_room_snapshot`, `get_my_active_room` | SECURITY INVOKER | `authenticated` | RLS applies |
| `is_room_member` | SECURITY DEFINER, STABLE | `authenticated` | Returns only a boolean |
| `persist_round_transition`, `persist_round_start` | SECURITY DEFINER | **`service_role` only** (REVOKE from PUBLIC) | The only writers of game state |
| `report_client_error` | SECURITY DEFINER | `authenticated` | Rate-limited, truncates input |

All SECURITY DEFINER functions: `REVOKE EXECUTE … FROM PUBLIC` first, then grant explicitly.

### 2.3a As implemented (Prompt 2: lobby)

- `anon` and `authenticated` hold **no table privileges** on `public.rooms`, `public.room_players` or `private.rate_limits`, and RLS is enabled on all three with no policies. Reads go only through `get_room_snapshot`, which returns no `user_id` values.
- `authenticated` can execute exactly ten lobby RPCs plus `private.can_access_room_topic`. `anon` can execute nothing. Every SECURITY DEFINER function pins `search_path = ''` and schema-qualifies objects.
- Rate limits use a fixed window, one row per (user, action): `create_room` 5/10 min, `join_room` 20/10 min, `heartbeat` 10/min. Rejected attempts **are counted** (errors are returned, not raised), so code brute force is throttled. A per-user cap allows 3 live memberships.
- **Display names:** NFC-normalized, trimmed, internal whitespace collapsed, 2–20 characters, and an allowlist of Latin (including Latin-1 and Extended), Greek, Cyrillic, ASCII digits, space and `. _ -`. Uniqueness is per room, case-insensitive (`name_key = lower(display_name)`). The Latin/Greek/Cyrillic scope is a **final owner decision for v1** (2026-10-06); other writing systems are out of scope.
- Not yet implemented: CAPTCHA (Turnstile), cleanup cron jobs, and the bundle secret scan.

### 2.3b As implemented (Prompt 3: gameplay)

| Class | Storage | Client path |
|---|---|---|
| PUBLIC | `games`, `rounds.public_state` (domain `projectPublic`), `round_events`, `score_entries` | `get_game_snapshot(room_id)`: active members only |
| ROUND-REVEALED | `rounds.reveal` (domain `projectReveal`). A CHECK constraint forbids it while `phase <> 'ROUND_ENDED'`. | Same snapshot, after the round ends |
| PLAYER-PRIVATE | `round_player_private` (domain `projectPrivate`: own role, own hand with `handPosition`, own survey results) | `get_my_game_state(room_id)`: the caller's row only; no player-id parameter exists |
| SERVER-ONLY | `private.round_secrets` (full domain state including deck order, all hands, all roles, set-aside role, destination identities, seed; deleted at round end) and `private.command_log` | None. Only the service-role persistence functions touch them. |

- Clients hold no privileges on any gameplay table.
- `game_persist_*` and `game_server_context` are executable only by `service_role`.
- Realtime pings carry identifiers and versions only.
- Survey results are persisted in the actor's private projection, so they survive refetch and reconnect, and never appear in public state or events.
- Verified by `supabase/tests/database/game_security.test.sql` (33 assertions) and `tests/integration/game-pipeline.test.ts` (8 scenarios, including the timeout race).

### 2.4 Service role

- The service role key exists only in Edge Function secrets and CI secrets. It **never** appears in the frontend bundle, which only receives `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. A CI check greps the built bundle for the service key prefix and JWT `role":"service_role`.

---

## 3. Trust boundaries

```
 Untrusted                         │ Trusted
 ──────────────────────────────────┼───────────────────────────────────────────
 Browser UI, local state,          │ Edge Function (JWT-verified identity,
 client-side domain hints,         │   authoritative domain execution)
 command payloads,                 │ SECURITY DEFINER SQL (identity from auth.uid(),
 Realtime presence payloads,       │   CAS, locking, constraints)
 client clock                      │ Postgres constraints & RLS
```

The server derives these values itself and **never** reads them from the client: player identity and seat, whether it is the player's turn, hand contents, card type (looked up from the card instance ID inside the actor's secret hand), current time, randomness, and whether the round ended or who won.

The client supplies only: command type, card instance ID, target coordinates/player/slot/tool, rotation, `expectedVersion`, `commandId`, and room/round IDs, which are cross-checked against membership.

---

## 4. Threat model and mitigations

| # | Threat | Attack | Mitigation |
|---|---|---|---|
| T1 | Querying another hand | `select * from round_player_private` | RLS `user_id = auth.uid()`. Secret state sits in `round_secrets`, which has no grants. pgTAP test: as user B, a select returns 0 of A's rows. |
| T2 | Querying roles | Read the roles table, the reveal column or the event log during a round | Roles exist only in private rows and secret state. `reveal` is NULL until the end (CHECK constraint). Events never contain roles. |
| T3 | Inspecting deck order or future cards | Read the secret table, infer from card IDs, watch the draw count | `round_secrets` is unreadable. Card instance IDs are random per round and carry no type or position. Only counts are public. The seed is never exposed. |
| T4 | Learning hidden destinations | Read the board JSON, scout logs or the reveal column | The public board stores a hidden slot as `{slot, hidden:true}` with no identity. The `DESTINATION_SCOUTED` event has no identity. The scout result goes only to the actor's private row and HTTP response. |
| T5 | Forged card ID | Send a card ID for a card type the player does not hold | The domain looks up the instance ID **in the actor's hand inside secret state**. If it is not found: `CARD_NOT_IN_HAND`. The type always comes from the server record. |
| T6 | Playing a card not in hand | Same as T5, or a card from another player's hand | As T5. Hands are per player inside secret state. |
| T7 | Playing out of turn | Call `game-command` while another player is active | The domain checks `actor == activePlayer`. The actor is derived from the JWT, then the membership row. |
| T8 | Illegal path placement | Send coordinates that the UI would not allow | Server-side `isPlacementLegal` runs the complete GAME_RULES §7.1 validation. Domain unit tests plus a simulation fuzz test cover it. |
| T9 | Replaying the same request | Resend a captured request | `commandId` is the idempotency key. A stored response is returned and nothing is applied twice. A replay with a fresh `commandId` but an old `expectedVersion` fails `STALE_STATE`. A command_log row bound to a different user returns `FORBIDDEN`. |
| T10 | Concurrent requests (two tabs or scripted) | Fire N commands at the same time | CAS on `round_secrets.version` inside `persist_round_transition`, so exactly one commits per version. Lobby RPCs lock the room row with `FOR UPDATE`. |
| T11 | Manipulating room capacity | Join beyond capacity, or set capacity to 50 | Capacity is CHECKed to 3–10. `update_room_settings` is host-only and LOBBY-only, and capacity must be ≥ members. `join_room` counts under a row lock. A unique (room, seat) constraint with seat < capacity backs this up. |
| T12 | Impersonating another player | Send someone else's `playerId`, or edit `room_players.user_id` | `playerId` is never accepted as the actor. It is derived from `auth.uid()`. There are no client writes to `room_players`. Other players' auth UIDs are not exposed. |
| T13 | Direct REST writes | `POST /rest/v1/rounds`, `PATCH` scores | INSERT/UPDATE/DELETE are revoked for anon/authenticated on all tables, with RLS as a second layer. pgTAP tests try each write and expect a permission error. |
| T14 | Realtime leakage | Subscribe to `postgres_changes` on secret tables, or join another room's channel | Postgres Changes is not used for game tables. The publication contains no game tables, so secrets cannot be streamed. Broadcast is on **private** channels, authorised by an RLS policy on `realtime.messages` that requires membership. Payloads are only version numbers. Clients cannot send broadcasts, because the policy allows INSERT for presence only. |
| T15 | XSS through player names | A name such as `<img onerror>` | Server-side validation through a character allowlist (ARCHITECTURE §6). React escapes text by default. `dangerouslySetInnerHTML` is banned through ESLint. A strict CSP without `unsafe-inline` scripts. Names are never placed into `title` or `href` attributes or any HTML string. |
| T16 | Spoofing names to look like another player | Mixed-script or homoglyph names, bidi overrides | Bidi and control characters are rejected. Names are unique per room after NFC and case-folding. The UI also shows the seat number and a colour plus shape marker. |
| T17 | Abuse: mass anonymous accounts or room spam | Scripted sign-ups, `create_room` floods | Cloudflare Turnstile CAPTCHA (free) on anonymous sign-in through Supabase Auth's CAPTCHA integration. Supabase Auth rate limits for anonymous sign-ins. Per-user DB rate limits: `create_room` 5/10 min, `join_room` 20/10 min, `heartbeat` 10/min, game commands 20/10 s and 120/min, error reports 10/min. Cap of 3 ACTIVE room memberships per user. |
| T18 | Room code brute force | Enumerate codes through `join_room` | 31⁶ ≈ 887M code space. `join_room` is rate-limited per user. Codes cannot be enumerated through SELECT. Rooms close when idle. |
| T19 | Denial of service on a game | AFK forever, or spam timeouts | Turn timer and auto-discard. AFK short timer. `RESOLVE_EXPIRED_TURN` is accepted only from ACTIVE members, only when the server's own clock is past the deadline, only for the current `expectedTurnNumber` and `expectedVersion`, and is idempotent per turn (ARCHITECTURE §8.1). It falls under the game-command rate limit. |
| T19a | Premature or racing timeout | A client sends `resolveExpiredTurn` early to skip a rival's turn, or many clients race | The deadline is compared only to server time (`TURN_NOT_EXPIRED` otherwise). Turn-number and version checks plus the CAS mean exactly one transition per turn. Losers get `TURN_ALREADY_RESOLVED`, with no side effects. |
| T19b | Choosing which card is auto-discarded | A client reorders its hand to make a timeout discard a specific card | The discarded card is the lowest **server-owned** `handPosition` in secret state. Client display order is never sent or used. |
| T20 | Clock manipulation | A client claims the deadline has passed | The server compares against its own `now()`. The client clock is display-only. |
| T21 | Seeing secrets through error messages | Probe validation errors to learn hidden state | Error codes must not depend on hidden information. Validation order checks public preconditions first. Destinations never constrain placement, so placement legality never depends on secrets. `SCOUT` on a slot only reveals whether the slot is *publicly* revealed. |
| T22 | Learning secrets through timing or response size | Compare latencies | Responses have a uniform shape. The scout identity is returned only to the actor. Considered low risk. |
| T23 | Leaking the service key | Bundle includes the secret | Only `VITE_*` vars are bundled. CI scans the bundle. Secrets live only in Netlify and Supabase dashboards and GitHub Actions secrets. |
| T24 | Edge Function abuse without auth | Call the function with no or a forged JWT | `verify_jwt` is on, and `getUser()` validates the token server-side. `game-maintenance` accepts no user JWTs. It requires the `MAINTENANCE_SECRET` header, compared in constant time, and is called only by pg_net from pg_cron. |
| T25 | Logs leaking secrets | Edge logs print full state | Structured logs include only IDs, version, outcome and code. A test asserts the log formatter strips `state`, `hand` and `role` keys. |
| T26 | Clickjacking | Embedding the game in a frame | `frame-ancestors 'none'` and `X-Frame-Options: DENY`. |
| T27 | Starting a game early or forcing a round | A non-host calls `START_GAME` or `START_NEXT_ROUND` | Host check plus the guards in ARCHITECTURE §4.2. `START_NEXT_ROUND` from a non-host is accepted only after `results_deadline`. |
| T28 | Rejoining as a new identity to see a second role | Join with a second anonymous user | Joining an IN_GAME room is rejected. One identity gives one seat. Multiple browsers would only give separate seats in the lobby, which is visible to everyone and is a social issue rather than a leak. |
| T29 | Seat hijacking through a "recovery" path | Claim to be a disconnected player from another device | v1 has **no** seat-recovery path (owner decision D2). A seat is bound to `room_players.user_id = auth.uid()` of the original anonymous session. With no transfer mechanism, there is nothing to hijack. A trade-off is accepted: a player who loses their session loses the seat. |

---

## 5. Frontend hardening

- **CSP** (Netlify `_headers`):
  ```
  default-src 'self';
  script-src 'self' https://challenges.cloudflare.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;   # unsafe-inline for styles only if a dependency needs it; prefer removing
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data:;
  connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co;
  frame-src https://challenges.cloudflare.com;
  frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';
  ```
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- No secrets in localStorage beyond the Supabase session itself. Private game data is kept only in memory (the query cache) and never persisted to storage.
- Dependencies: `npm audit` in CI (Tier B: report only; Tier C: fails on high severity). Lockfile committed.

---

## 6. Data lifecycle and cleanup

The scheduled jobs below are **cleanup and safety nets only**. No job resolves turns, starts rounds or otherwise moves an active game forward. If every scheduled job is disabled, gameplay is still correct (ARCHITECTURE §8.2).

| Job | Frequency | Rule |
|---|---|---|
| Delete round secrets | inline | `round_secrets` row deleted inside the round-ending transaction |
| Lobby stale members | **lazily, inside lobby RPCs** (ARCHITECTURE §6). No scheduler is needed. | ACTIVE members in LOBBY rooms with `last_seen_at` older than 120 s → REMOVED (host migrates) |
| Idle room close (safety net, optional) | every 5 min | Rooms with no member heartbeat for 30 min → CLOSED. Running games in them → ABANDONED. |
| Purge closed rooms | hourly | Rooms CLOSED for over 7 days, with all their games, rounds, events and scores, are deleted (cascade) |
| Idempotency log | hourly | `command_log` older than 24 h |
| Rate-limit buckets | hourly | windows older than 1 h |
| Error reports | daily | older than 14 days |
| Anonymous users | daily | Auth anonymous users with no sign-in for 30 days and no ACTIVE membership → deleted through the Admin API from `game-maintenance` |

---

## 7. Security verification (where it is tested)

| Area | Test | Tier |
|---|---|---|
| Domain validation (T5–T8, T21) | Vitest unit tests on `applyCommand` | A/B |
| Projection safety | Unit tests: `projectPublic` output contains no role, hand, seed or hidden destination identity. A property test over random rounds checks this. | A/B |
| RLS and grants (T1–T4, T11–T14) | pgTAP: impersonate users A and B, assert row counts and permission errors. Also checks that every table has RLS enabled. | C |
| Idempotency and concurrency (T9, T10) | Integration test: N parallel commands against the local stack, exactly one commits | C |
| Realtime authorisation (T14) | Integration: a non-member's channel subscription is rejected | C |
| Bundle secret scan (T23) | CI script on `dist/` | B |
| XSS (T15) | Component test rendering a malicious name, plus the ESLint rule | A/B |
