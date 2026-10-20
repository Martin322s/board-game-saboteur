# PRODUCT_SPEC — v1

> Status: **Specification v1 (Prompt 0)**. Working title: **not yet chosen**. Internal codename: `tunnels`.
> Related: [GAME_RULES.md](GAME_RULES.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY_MODEL.md](SECURITY_MODEL.md) · [TEST_STRATEGY.md](TEST_STRATEGY.md) · [RELEASE_PLAN.md](RELEASE_PLAN.md)

---

## 1. Product goals

An online party/strategy game in the browser. Players dig tunnels together on a shared board while hidden roles create suspicion and bluffing. Players should be able to start in under a minute, with no sign-up and on any device.

| Goal | Measure of success |
|---|---|
| Fast start | From landing page to lobby in ≤ 3 taps or clicks, with no account needed |
| Works on phones | Fully playable on a 360 × 640 viewport in portrait |
| Fair and secure | A player cannot learn hidden information through the UI, DevTools or direct API calls |
| Resilient | A refresh or a short network drop puts the player back in their seat in under 5 s |
| Understandable | A new player can finish a round with only the in-game help |
| Bulgarian first | All UI copy in Bulgarian. English can be added without code changes beyond a new dictionary. |
| Extensible | New cards, roles or modes are added through domain config and resolvers, not UI rewrites |

### 1.1 Target audience

- Groups of friends, 3–10 players, playing remotely while on a voice call or sitting together with their own phones.
- Casual to mid-core players. Rounds are short, there are 3 rounds per game, and the rules stay light.

---

## 2. Feature scope

### 2.1 In v1

| Area | Features |
|---|---|
| Identity | Silent anonymous authentication. A display name is entered each time a player creates or joins a room and is remembered locally as the default. |
| Rooms | Create a room with a capacity of 3–10. A 6-character room code. Join by code. Join by a share link `/r/{CODE}`. Copy/share button. |
| Lobby | Player list, host badge, ready toggle, capacity, connection status, host can change capacity, host can remove a player (lobby only), host starts the game. |
| Gameplay | Everything in GAME_RULES.md: 2 factions, 66-card deck, board, 5 action categories, turn timer, 3 rounds, scoring, final leaderboard. |
| Realtime | Live updates for every room and game change. Presence indicators. |
| Resilience | Reconnect after refresh or network loss. Multi-tab safety. Host migration. Turn timeouts. |
| Results | Round results screen with roles revealed. Final leaderboard. "Play again" in the same room. |
| UX | Dark theme. Responsive layout for desktop and mobile. Board pan/zoom. Rotate control. Legal placement highlights. Action log. |
| A11y | Keyboard play on desktop, ARIA labels, visible focus, reduced motion, meaning never carried by colour alone. |
| i18n | Bulgarian (`bg`) dictionary. The architecture is ready for `en`. |
| Audio | Optional SFX for key events with a persisted mute toggle. Built in a late iteration, see RELEASE_PLAN.md. |
| Help | An in-game "How to play" sheet, written originally. |
| Production | Error boundary, client error reporting, rate limits, CAPTCHA on anonymous sign-in, cleanup jobs, CSP. |

### 2.2 Not in v1 (explicitly deferred)

- Accounts, profiles, friends, persistent stats or match history.
- **Seat recovery beyond the same browser session** (owner decision, final): cross-device recovery, recovery after clearing storage or closing a private window, rejoin tokens, and optional permanent accounts. See §3.8.
- Spectators. Joining a game already in progress (only reconnecting to your own seat is supported).
- Extra roles (for example a neutral or traitor role), personal-reward cards, any expansion cards.
- In-game text chat. Players are expected to use external voice or text chat, which also removes moderation scope.
- Custom rule settings (rounds, timer length, deck tweaks). v1 uses fixed rules. Only capacity is configurable.
- Bots or AI players.
- Public matchmaking or a room browser.
- Native apps or a PWA install prompt.
- Monetisation.

### 2.3 Prepared for, but not built

- An `en` locale dictionary.
- Game modes: the `games.mode` column and a domain `GameMode` config object (v1 has only `STANDARD`).
- Role registry and card category registry (see GAME_RULES §5.3).

---

## 3. User flows

### 3.1 Landing → create room

1. `/`: landing page with the title placeholder, a short pitch, **"Създай стая"** (Create room) and **"Влез в стая"** (Join room).
2. Create: a form with display name (prefilled from localStorage) and capacity (stepper 3–10, default 6), then **Create**.
3. The client makes sure an anonymous session exists. If none does, it signs in anonymously and passes the CAPTCHA token.
4. RPC `create_room(display_name, capacity)` → `{ roomId, code }`.
5. The client navigates to `/r/{CODE}`, which shows the lobby with the player as host.

### 3.2 Join room

- Through the form: name and code. The code input is uppercase, ignores spaces and case, and accepts only characters from the code alphabet.
- Through a link: `/r/{CODE}`. If the player is not yet a member, a name prompt is shown, then the client joins.
- RPC `join_room(code, display_name)`. Possible results: success, `ROOM_NOT_FOUND`, `ROOM_FULL`, `GAME_IN_PROGRESS`, `NAME_TAKEN`, `RATE_LIMITED`.

### 3.3 Lobby

- The lobby shows: room code (large, with copy and native share), "N / capacity", the player list (name, host crown, ready check or icon, connection dot plus text label, "you" marker).
- A non-host player can toggle ready and can leave.
- The host can change capacity (it cannot go below the current player count), remove a player and start the game.
- The **Start** button is enabled only when there are at least 3 players and every non-host player is ready. When it is disabled, a hint explains why ("Изчакване на 2 играчи да са готови").

### 3.4 In game

- On round start, each player sees a full-screen **role reveal card** for their own role. It can be dismissed and is always reachable through a "Моята роля" chip.
- On your turn: an attention cue (banner, plus sound if enabled, plus a subtle vibration on mobile where allowed). Choose a card:
  - **Path card**: legal cells are highlighted (outline plus "+" icon). A rotate button sits on the card and the `R` key rotates it. Tap or click a cell to place it, and tap again to confirm on mobile (two-step to avoid mistaps).
  - **Action card**: valid targets are highlighted (player chips, destination slots or board cells). Select a target, then confirm.
  - **Discard**: a "Изхвърли" button on the selected card, with a confirmation.
- When it is not your turn, you can inspect your hand, the board and the log. Play controls are disabled and say whose turn it is.
- Scout result: a private modal showing the destination identity. After that, a "known" badge (eye icon) appears on that slot for you only.

### 3.5 Round results → next round

- Shows: the winner faction banner, every role (including the set-aside one, shown as "Неразкрита роля в тестето" — "unused role"), points earned this round, and the running totals.
- The host presses **"Следващ рунд"** (Next round). After 45 s anyone can press it, so a missing host cannot block the game.

### 3.6 Game finished

- The final leaderboard with ranks (shared ranks for ties), totals and rounds won.
- **"Нова игра"** (host): the room returns to LOBBY with the same players, ready flags reset and capacity kept.
- **"Изход"** (anyone) leaves the room.

### 3.7 Reconnect

- On app load: restore the Supabase session, then call `get_my_active_room()`. If an active membership exists, offer or redirect to `/r/{CODE}`, which loads the snapshot.
- A banner shows "Връзката е прекъсната — опит за повторно свързване…" while realtime is disconnected. The game view becomes read-only until it resyncs.

### 3.8 Identity and seat recovery (v1 limitation)

- A player's identity **is** their Supabase anonymous session, stored in this browser.
- **The seat is restored** after a refresh, a network drop, a backgrounded or suspended tab, and closing and reopening the app in the same browser profile.
- **The seat is not restored** from a different device or browser, after clearing site data, after closing an incognito window, or after very long inactivity. The player can still join new rooms, but cannot take back the old seat. That seat stays in the game as a disconnected player and its turns time out automatically.
- UI copy: the lobby's help text and the "Leave" confirmation explain this in one sentence ("Играта е свързана с този браузър…" — "The game is tied to this browser…").
- Rejoin tokens, seat-transfer codes and permanent accounts may come in a later version and are out of scope for v1.

### 3.9 Turn timeouts (player view)

- Every turn shows a 60 s countdown that matches the server deadline.
- When the time runs out, any connected player's app asks the server to resolve the expired turn. The server discards the timed-out player's oldest card (the lowest server hand position) and moves play on.
- Play keeps moving as long as at least one player is connected. No background service is needed.

---

## 4. Lobby rules summary

Details are in ARCHITECTURE.md §6.

| Rule | Value |
|---|---|
| Room code | 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0 O 1 I L`) |
| Capacity | 3–10, chosen by the host, enforced server-side |
| Display name | 2–20 characters after trim and NFC normalisation. Letters from the **Latin, Greek and Cyrillic** scripts, ASCII digits, space, `- _ .`. Unique in the room, case-insensitive. Other writing systems (e.g. Chinese, Arabic) are out of scope for v1 (owner decision, 2026-10-06). |
| Min to start | 3 players and every non-host player ready |
| Join after start | Not allowed. Only existing members can reconnect. |
| Host migration | To the lowest-seat connected member, when the host leaves or has been unresponsive for 60 s |
| Lobby inactivity | A member with no heartbeat for 120 s is removed from a LOBBY room, checked lazily by lobby actions |
| Room expiry | A room with no heartbeat from any member for 30 min is closed |

---

## 5. UX specification

### 5.1 Visual direction

- A modern dark "underground" theme: deep slate background, warm amber accents for tunnels and light, cool teal for interactive affordances.
- **No illustrative card artwork in v1.** Path cards are drawn procedurally as SVG from their topology data: rounded tunnel strokes and an X marker for dead-end centres. Action cards use original iconography (simple line icons, either drawn in-house or taken from an MIT/ISC-licensed set such as Lucide) plus a text label.
- Typography: one open-source font family with full Cyrillic support (for example Inter or Manrope via Google Fonts, or self-hosted).

### 5.2 Desktop layout (≥ 1024 px)

```
┌──────────────────────────────────────────────────────────────────┐
│ Room ABC234 · Round 2/3 · Deck 31 · ⏱ 0:42      [role] [🔊] [⋯]  │
├──────────────┬───────────────────────────────────────────────────┤
│ Players      │                                                   │
│ ▶ Мария  ●   │               BOARD (pan/zoom)                    │
│   Иван   ●🔧 │                                                   │
│   Петър  ◌   │                                                   │
│ ...          │                                                   │
│ Event log    │                                                   │
├──────────────┴───────────────────────────────────────────────────┤
│ Your hand: [card][card][card][card][card][card]  [⟳ Rotate] [🗑] │
└──────────────────────────────────────────────────────────────────┘
```

### 5.3 Mobile layout (< 768 px, portrait)

- Top bar: round, deck count, timer, turn owner.
- The board fills the middle. Supports pinch-zoom, one-finger pan, and a "centre on tunnels" button.
- Bottom sheet: a horizontally scrollable hand. The selected card lifts up and shows Rotate, Discard and Cancel buttons (each target ≥ 44 × 44 px).
- The player list sits in a collapsible drawer. The always-visible strip shows the active player's avatar and name.
- Two-step placement: tap a cell to preview a ghost card, then tap "Постави" (Place) to commit.

### 5.4 Information the UI must always communicate

| Information | How (never by colour alone) |
|---|---|
| Whose turn | Highlight plus ▶ icon in the player list, top-bar text, plus "Твой ход!" banner when it is you |
| Your role | The role chip (tap to reveal, with a hide-from-shoulder-surfers toggle) |
| Your cards | Hand area with category icons and labels |
| Broken tools | An icon per tool with a strike-through glyph, plus an ARIA text "Свредел: счупен" |
| Legal / illegal placement | Legal cells show a dashed outline and "+" glyph. Hovering an illegal cell shows ⊘ plus a reason tooltip. |
| Destination state | Hidden "?", privately known (eye badge plus identity, visible only to you), revealed (identity icon and text) |
| Deck remaining | Count in the top bar, plus "Последни карти" (last cards) styling when it is 0 |
| Round / score | "Рунд 2/3" in the top bar. A scoreboard is available from the menu at any time. |
| Connection | A dot plus text in the player list. A global banner when *you* are offline. |
| Turn timer | Numeric countdown plus a progress ring. An urgent style in the last 10 s. |

### 5.4a As implemented (Prompt 4)

- **Desktop:** top bar (title, room, round, turn banner «ТВОЙ ХОД» / «Ход на …», countdown, connection, help, sound, menu); players and activity feed in a left column; the board fills the centre; the hand plus a contextual action bar run along the bottom.
- **Phone:** compact top bar (help and sound move into the menu), a horizontally scrolling player strip, the board in the main viewport with +/−/«Центрирай» and pinch/drag, and a scrollable hand.
- **Round start:** «Рунд N от 3» → «Виж ролята си» → role card → «Готов съм». The role is then available only through a tap-to-reveal chip, so a neighbour can't glance at it.
- **Results:** winner, reason, connector, gold location, all roles plus the set-aside role, points this round and in total. «Започни рунд N» is available to the host, and to anyone once the results deadline passes. The dialog can be minimised to look at the board.
- **Final:** leaderboard with shared ranks and the winners. The host gets «Играй отново»; everyone gets «Излез от стаята».
- **Keyboard:** `R` rotates the selected tunnel (physical key, so it works with Cyrillic layouts); `Esc` cancels the selection or closes a dialog. Focus is trapped in dialogs and returns to where it was on close.
- **Sound:** a few short synthesized tones (Web Audio, no audio files). Muted by default; the preference is stored per browser; audio is only enabled from the user's click.

### 5.5 Accessibility

- Every interactive element can be reached by keyboard and has a visible focus ring (2 px, high contrast).
- The board is keyboard-navigable as a grid: arrow keys move the cursor cell, `Enter`/`Space` places, `R` rotates and `Esc` cancels. Uses the `role="grid"` pattern, with each cell's `aria-label` describing its contents ("Клетка 3,−1: тунел изток–запад").
- The hand is a `listbox`. Action targets are announced.
- An `aria-live="polite"` region announces turn changes, placements, reveals and the round result.
- `prefers-reduced-motion` turns off card fly-ins and board easing. State changes become instant.
- Contrast is WCAG 2.2 AA (4.5:1 for text, 3:1 for UI components).
- Focus is managed when modals open and close.

### 5.6 Audio (planned for a later iteration)

These SFX events are deduplicated by `(roundId, eventSeq)`:

- `your_turn`, `card_placed`, `action_played`, `destination_revealed`, `round_won`, `round_lost`, `game_finished`.
- Muted by default until the first user gesture, so there is no autoplay violation. The mute preference is stored in localStorage.
- Events from the initial snapshot load and from catch-up refetches never play sounds. Only events with `seq > lastSeenSeq` that arrive while the tab is visible play.
- All sound assets are original or CC0, with licences recorded in `docs/ASSET_LICENSES.md` once they are added.

---

## 6. Internationalisation

- The default and only shipped locale in v1 is `bg`. Every user-visible string comes from a typed dictionary (`src/i18n/bg.ts`). Hard-coded UI strings fail lint, enforced later with a custom lint rule or review checklist.
- Server and domain errors are **stable codes** (`NOT_YOUR_TURN`), never prose. The client maps codes to i18n keys.
- Plurals use `Intl.PluralRules`. Numbers and dates use `Intl.*`.
- Card and role names are i18n keys derived from type IDs (`card.PATH_CROSS.name`).
- Adding `en` later means adding `src/i18n/en.ts` that satisfies the same type, plus a language switcher.

---

## 7. Performance targets

| Metric | Target |
|---|---|
| Landing page JS (gzip) | ≤ 200 KB initial; the game route is code-split |
| Command round-trip (click → all clients updated) | p50 ≤ 500 ms, p95 ≤ 1.5 s on hosted Supabase in an EU region |
| Board render | 60 fps pan/zoom on a mid-range Android with ≤ 70 cards |
| Reconnect | Snapshot restored ≤ 2 s after the network returns |

---

## 8. Non-functional requirements

- **Security**: see SECURITY_MODEL.md. Hidden information is never sent to a client that should not have it.
- **Privacy**: no personal data beyond the display name and anonymous user ID. No analytics cookies in v1. Privacy notice page at `/privacy` (BG).
- **Data retention**: room and game data is deleted 7 days after the room closes. Secret round state is deleted when the round ends.
- **Cost**: must run on the Supabase and Netlify free tiers for beta. No paid services are required.

---

## 9. Original product / IP safety

These rules apply to every iteration:

1. **Mechanics only.** The hidden-role tunnel-building mechanics take general inspiration from existing tabletop games. Game mechanics are not themselves protected, but the *expression* of a game is, and we copy none of it.
2. **Original branding.** We do not use any third-party logo, trade dress or tagline. *Owner decision (2026-10-06): the Bulgarian public product name is «Саботьор» and the factions are «джуджета» and «саботьори». This supersedes the earlier "no Saboteur name" wording for the name itself. The trademark clearance in the next sentence is therefore mandatory before public launch (see the Prompt 3 report).* The final product name must be checked for trademark conflicts in BG/EU (EUIPO) and in the main app and web domains before launch.
3. **Original UI.** The layouts, colours and interactions are our own designs and are not modelled on any existing digital or physical edition.
4. **Original artwork.** No scanned, traced or AI-imitated card art from existing products. v1 uses procedural SVG tunnels and licensed or original icons.
5. **Original card names and text.** The card names in GAME_RULES §14 are our working terms. All card and rule text is written from scratch in our own words, and no rulebook passages are translated or paraphrased.
6. **Independent rules text.** The in-game help is written from GAME_RULES.md (our spec), not from any third-party rulebook.
7. **No copied assets.** No fonts, sounds, icons or images without a licence that permits commercial web use. Every third-party asset is listed in `docs/ASSET_LICENSES.md`.
8. **No affiliation claims.** The product must not claim or imply any official affiliation, endorsement or licence from any tabletop publisher. Marketing copy must not name third-party games as a comparison in ways that imply affiliation.
9. **Internal naming.** Until branding is chosen, code and docs use generic identifiers (`MINER`, `DISRUPTOR`, `tunnels`). The repository name `board-game-saboteur` is internal and must not appear in user-facing UI, metadata, page titles, the Netlify site name, or the production domain. Renaming the repo before public launch is recommended.

---

## 10. Glossary

| Term | Meaning |
|---|---|
| Room | A lobby addressed by a code. It holds a sequence of games. |
| Game | 3 rounds played by a fixed set of seated players |
| Round | One deal: roles, deck and board, ending in a win for one faction |
| Seat | A player's fixed position (0…capacity−1), which sets turn order |
| Member | A non-left player in a room |
| Active player | The player whose turn it currently is |
| Snapshot | The client's combined view: public state plus its own private state |
| State version | A per-round integer, incremented once per committed command |
