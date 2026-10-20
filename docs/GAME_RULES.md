# GAME_RULES — v1 Deterministic Rules

> Status: **Specification v1 (Prompt 0)**. This is the single authoritative source for gameplay rules.
> Every number in this file must be in the domain config module (`src/domain/config/`), not hard-coded in UI or SQL.
> If code and this document disagree, that is a bug. Fix one of them and record the change in the changelog at the end of this file.

Working terminology: the product name has not been chosen. This document uses neutral **internal identifiers** (`MINER`, `DISRUPTOR`, `DRILL`, …). The Bulgarian user-facing working terms are listed in §14 and are placeholders until branding is final.

---

## 1. Overview

- 3–10 players share a grid board. A **Start** cell sits on one side and three face-down **Destination** cells on the other.
- At the start of each round, every player gets a secret role: **MINER** or **DISRUPTOR**.
- MINERS try to build a continuous tunnel from Start to the one Destination that holds the **TREASURE**.
- DISRUPTORS try to stop them before the cards run out.
- The game is **3 rounds**. Roles are re-dealt each round. Points add up across rounds, and the highest total wins.

---

## 2. Player count and setup tables

| Constant | Value |
|---|---|
| `MIN_PLAYERS` | 3 |
| `MAX_PLAYERS` | 10 |
| `ROUNDS_PER_GAME` | 3 |

### 2.1 Role pool, by player count

Each round the server builds a **role pool** with **N + 1** role tokens (N = number of seated, non-left players at round start). It shuffles the pool, deals one token to each player and sets **one token aside face-down**. The set-aside token is never shown during the round, so players cannot be sure how many DISRUPTORS are in play.

| Players (N) | MINER tokens | DISRUPTOR tokens | Pool size | DISRUPTORS actually in play |
|---|---|---|---|---|
| 3 | 3 | 1 | 4 | 0 or 1 |
| 4 | 4 | 1 | 5 | 0 or 1 |
| 5 | 4 | 2 | 6 | 1 or 2 |
| 6 | 5 | 2 | 7 | 1 or 2 |
| 7 | 5 | 3 | 8 | 2 or 3 |
| 8 | 6 | 3 | 9 | 2 or 3 |
| 9 | 7 | 3 | 10 | 2 or 3 |
| 10 | 7 | 4 | 11 | 3 or 4 |

The token values in this table are balance-tunable. They live in `src/domain/config/roles.ts`.

### 2.2 Initial hand size

| Players (N) | Hand size |
|---|---|
| 3–5 | 6 |
| 6–7 | 5 |
| 8–10 | 4 |

Check: the largest deal is 10 × 4 = 40 cards, which is less than the 66-card deck. Every player count leaves a draw pile, from 26 cards (10 players) to 48 cards (3 players).

### 2.3 Round setup algorithm (exact order)

Input: the ordered list of eligible players (seat ascending), round number `r`, a round seed `S` (128-bit, cryptographically random, generated server-side), and the previous round's starting seat (if any).

1. `rng = createRng(S)`. Use one PRNG stream per round and consume it in exactly the order below. Implementation: `xoshiro128**` seeded through `splitmix64`, or another documented seeded PRNG. The choice is fixed in `src/domain/rng/`.
2. **Roles**: build the role pool from §2.1 in the order `[MINER × m, DISRUPTOR × d]`. Fisher–Yates shuffle it with `rng`. Deal pool[i] to the player at list index i. The last token is set aside.
3. **Destinations**: build `[TREASURE, EMPTY, EMPTY]`, Fisher–Yates shuffle it with `rng`, and assign the result to destination slots 0, 1, 2 (§4.2).
4. **Deck**: expand the catalog (§5) into card instances in catalog order. Fisher–Yates shuffle with `rng`. Give each instance an opaque ID: `"c" + 10 base32 characters` drawn from `rng`, regenerated if it collides inside the round. Card IDs carry no information about card type or deck position.
5. **Deal**: deal round-robin, one card at a time, starting at list index 0, until every player holds the hand size from §2.2. Cards are taken from the top of the deck (index 0). Each dealt card gets the player's next **hand position** (§6.2): the first card dealt to a player gets 0, the next gets 1, and so on.
6. **Starting player**:
   - Round 1: list index `rng.nextInt(N)`.
   - Round r > 1: the first eligible seat strictly after the previous round's starting seat, wrapping around.
7. All tools start intact for every player (§6.1). The board contains only Start and the three hidden Destinations.
8. The turn number is set to 1 and the turn deadline is set (§8.5).

Given the same inputs, setup must produce exactly the same state. That is required for tests and replay.

---

## 3. Factions and win conditions

| Faction | Goal | Wins the round when |
|---|---|---|
| `MINER` | Connect Start to the TREASURE destination | A path placement reveals the TREASURE (§7.3) |
| `DISRUPTOR` | Stop that from happening | The round ends by exhaustion (§9.2) |

- A player's role is visible only to that player during the round (see SECURITY_MODEL.md).
- At round end, every player's role and the set-aside token are revealed to everyone in the room.
- Roles are never revealed during the round. No card in v1 reveals another player's role.

---

## 4. Board geometry

### 4.1 Coordinates

- The board is a set of integer cells `(x, y)`. `x` grows **east** and `y` grows **south**, so north is `y − 1`.
- Bounds (inclusive): `x ∈ [0, 8]`, `y ∈ [−2, 2]`. The board is a fixed 5-row × 9-column matrix (45 cells). Start is column 1, destinations are column 9, and exactly seven tunnel-card columns (`x = 1…7`) lie between them. Placements outside the bounds are illegal (`OUT_OF_BOUNDS`).
- Each cell holds at most one card.

### 4.2 Fixed cells

| Cell | Coordinate | Notes |
|---|---|---|
| Start | `(0, 0)` | Open on all four sides, internally connected. Cannot be removed. |
| Destination slot 0 | `(8, −2)` | Hidden identity. Cannot be removed. |
| Destination slot 1 | `(8, 0)` | Hidden identity. Cannot be removed. |
| Destination slot 2 | `(8, 2)` | Hidden identity. Cannot be removed. |

The shortest connection from Start to any destination needs at least **7** path cards (cells x = 1…7).

### 4.3 Directions and edges

- Directions are `N`, `E`, `S`, `W`.
- `opposite(N)=S`, `opposite(E)=W`, and the reverse.
- `neighbor((x,y), N)=(x,y−1)`, `E=(x+1,y)`, `S=(x,y+1)`, `W=(x−1,y)`.

### 4.4 Path card topology (no image interpretation)

Each path card type defines:

- `openings: Set<Direction>`: sides that have a tunnel opening.
- `segments: Direction[][]`: a partition of `openings`. Openings in the same segment are connected through the card's centre. An opening that sits alone in its segment is a **dead end**. It counts as open for edge matching but connects to nothing else on the card.

Every opening belongs to exactly one segment. This model also supports future cards with two independent tunnels, such as a bridge with segments `[[N,S],[E,W]]`. v1 uses only "one connected segment" or "all openings isolated".

### 4.5 Rotation

- A path card can be placed at rotation `0` or `180` only.
- `rotate180` maps N↔S and E↔W across openings and segments.
- Rotations of 90° are **not** allowed in v1. The catalog (§5.1) already contains both orientations of every asymmetric shape.

### 4.6 Cell kinds and their edges

| Kind | Edges for matching | Connectivity |
|---|---|---|
| Start | Open on all 4 sides | One segment `[N,E,S,W]` |
| Path card | From its rotated topology | From its rotated segments |
| Destination (hidden **or** revealed) | **Never constrains** a neighbour's placement | Connects **only** through a neighbouring card's real opening facing it. Once revealed: one internal segment `[N,E,S,W]`. While hidden: not traversable. |

**v1.2 decision (owner-approved):** a destination is a special tile with two separate properties.

- **Placement:** a destination never makes a placement illegal. A neighbouring card may face it with an open **or** a closed side, as long as every ordinary neighbour constraint (§7.1 rule 9) is met.
- **Connectivity:** a destination is **not** a connectivity wildcard. It is connected to, and reached from, a neighbouring card **only** when that card has an **open** side facing the destination. A closed side facing a destination creates no connection: it does not reach, reveal or win through that destination.
- Reveal and gold victory (§7.3) use exactly this rule.
- A reached destination is revealed (§7.3). A revealed EMPTY destination stays traversable, but only through sides where a neighbouring card actually opens into it.
- The board draws a revealed destination's tunnel mouths only where a neighbouring tunnel actually connects.
- Only three sides exist on the board: destinations are in the last column (x = 8), so their east side is outside the 5×9 matrix.
- This is an intentional rule of this original game. It is not an attempt to reproduce another game's destination-card behaviour.
- As a result, whether a placement is legal depends only on **public** information, so the client can show legal placements without knowing any secret. The server still re-validates every placement.

---

## 5. Card catalog (v1): **66 cards**

Card **type IDs** are stable strings. Card **instance IDs** are opaque and random per round (§2.3).

### 5.1 Path cards: 39

Openings are listed at rotation 0. "Connected" means one segment holds all openings. "Dead end" means every opening is its own segment.

| Type ID | Openings (rot 0) | Rot 180 equivalent | Kind | Qty |
|---|---|---|---|---|
| `PATH_CROSS` | N E S W | same | connected | 5 |
| `PATH_T_EWS` | E W S | E W N | connected | 5 |
| `PATH_T_NSE` | N S E | N S W | connected | 5 |
| `PATH_STRAIGHT_EW` | E W | same | connected | 4 |
| `PATH_STRAIGHT_NS` | N S | same | connected | 3 |
| `PATH_CORNER_SE` | S E | N W | connected | 4 |
| `PATH_CORNER_SW` | S W | N E | connected | 4 |
| `DEAD_CROSS` | N E S W | same | dead end | 1 |
| `DEAD_T_EWS` | E W S | E W N | dead end | 1 |
| `DEAD_T_NSE` | N S E | N S W | dead end | 1 |
| `DEAD_STRAIGHT_EW` | E W | same | dead end | 1 |
| `DEAD_STRAIGHT_NS` | N S | same | dead end | 1 |
| `DEAD_CORNER_SE` | S E | N W | dead end | 1 |
| `DEAD_CORNER_SW` | S W | N E | dead end | 1 |
| `DEAD_END_S` | S | N | dead end | 1 |
| `DEAD_END_E` | E | W | dead end | 1 |
| **Subtotal** | | | 30 connected + 9 dead end | **39** |

### 5.2 Action cards: 27

| Type ID | Category | Target | Effect | Qty |
|---|---|---|---|---|
| `BREAK_DRILL` | sabotage | any player whose DRILL is intact (self allowed) | Breaks the target's DRILL | 3 |
| `BREAK_LAMP` | sabotage | any player whose LAMP is intact (self allowed) | Breaks the target's LAMP | 3 |
| `BREAK_ROPE` | sabotage | any player whose ROPE is intact (self allowed) | Breaks the target's ROPE | 3 |
| `REPAIR_DRILL` | repair | any player whose DRILL is broken (self allowed) | Repairs the DRILL | 2 |
| `REPAIR_LAMP` | repair | any player whose LAMP is broken (self allowed) | Repairs the LAMP | 2 |
| `REPAIR_ROPE` | repair | any player whose ROPE is broken (self allowed) | Repairs the ROPE | 2 |
| `REPAIR_DRILL_LAMP` | repair | a player plus one chosen tool from {DRILL, LAMP} that is broken | Repairs the chosen tool | 1 |
| `REPAIR_LAMP_ROPE` | repair | a player plus one chosen tool from {LAMP, ROPE} that is broken | Repairs the chosen tool | 1 |
| `REPAIR_DRILL_ROPE` | repair | a player plus one chosen tool from {DRILL, ROPE} that is broken | Repairs the chosen tool | 1 |
| `SCOUT` | inspect | one **hidden** destination slot | The actor privately learns that slot's identity | 6 |
| `COLLAPSE` | board | one cell holding a **path card** (not Start, not a destination) | Removes that path card from the board | 3 |
| **Subtotal** | | | | **27** |

**Deck total: 39 + 27 = 66.** The quantities are in `src/domain/config/deck.ts`. A unit test asserts the total is 66 and checks every quantity in this table.

### 5.3 Extensibility contract

Every card type is a data record `{ typeId, category, ...categoryData }`. The categories are `PATH | SABOTAGE | REPAIR | INSPECT | BOARD`. Each category has a single resolver function in the domain. Adding a card of an existing category is a data-only change. A new category needs a new resolver, a new target schema and new i18n keys. UI code must never branch on a specific `typeId`.

---

## 6. Player state

### 6.1 Tools

Each player has three tools: `DRILL`, `LAMP` and `ROPE`. Each one is `INTACT` or `BROKEN`. Tool state is **public**.

- A player with **at least one** broken tool is **blocked**. A blocked player cannot place path cards. They may still play action cards and discard.
- Tool state resets to all-intact at the start of each round.

### 6.2 Hand

- A hand is a set of card instances. Each instance has a **server-owned integer `handPosition`**.
- Each player has a per-round counter `nextHandPosition`, starting at 0. Every card that enters the hand (dealt or drawn) gets `handPosition = nextHandPosition`, and then the counter increases by 1.
- Positions are **never renumbered**. Removing a card leaves a gap, so positions are unique and strictly increasing in the order cards arrived.
- The **canonical hand order** is ascending `handPosition`. The server owns it and returns it in the private projection.
- A client may reorder cards visually as a local UI convenience. That order is never sent to the server and never affects rules.
- The owner sees their hand contents and positions. Everyone sees each player's **hand count**.

---

## 7. Placing a path card

### 7.1 Legality: all of these must hold

Validation runs in this order and the first failure is returned as the error code.

1. `ROUND_NOT_ACTIVE`: the round phase is `ROUND_ACTIVE`.
2. `NOT_YOUR_TURN`: the actor is the active player.
3. `CARD_NOT_IN_HAND`: the card instance is in the actor's hand.
4. `WRONG_CARD_CATEGORY`: the card's category is `PATH`.
5. `PLAYER_BLOCKED`: the actor has no broken tools.
6. `INVALID_ROTATION`: rotation ∈ {0, 180}.
7. `OUT_OF_BOUNDS`: the target is inside §4.1 bounds.
8. `CELL_OCCUPIED`: the target cell is empty.
9. `EDGE_MISMATCH`: for every occupied orthogonal neighbour **that is not a destination**, the two facing edges agree. Either both are open or both are closed.
10. `NOT_CONNECTED`: at least one opening `d` of the new card faces a neighbour cell `n` where:
    - `n` is Start, a path card, or a **revealed** destination,
    - `n` has an opening at `opposite(d)`, and
    - that opening of `n` is **reached** from Start (§7.2).

A card that only touches a hidden destination, or only touches path cards not connected to Start, is illegal.

### 7.2 Reachability (exact algorithm)

A node is `(cell, segmentIndex)`. The algorithm is a BFS over nodes:

1. Seed: Start's single segment.
2. From node `(c, s)`, for each opening `d` in segment `s`, look at cell `c' = neighbor(c, d)`. If `c'` holds a card **with an opening at `opposite(d)`** and is traversable (Start, path card, or revealed destination), enqueue `(c', segmentOf(c', opposite(d)))`.
3. An opening is **reached** if its segment node is visited.

Because a dead-end opening sits alone in its segment, the search reaches it but cannot continue through the card.

### 7.3 Destination reveal (runs after every successful path placement)

1. Recompute reachability.
2. For every **hidden** destination `D`, check whether any visited node `(c, s)` has an opening `d ∈ s` with `neighbor(c, d) = D`. If so, `D` becomes **revealed** (its identity becomes public).
3. If more than one destination is revealed at once, reveal all of them.
4. If any newly revealed destination is `TREASURE`, the round ends immediately with **MINERS win** (§9.1). The actor of this placement is recorded as the **connector**.
5. A revealed `EMPTY` destination stays on the board. It is traversable, so tunnels may continue through it. Entering or leaving it always requires the neighbouring card's **open** side facing it (§4.6, §7.2 step 2). Play continues normally.

A card whose side facing a hidden destination is **closed** is not an opening `d ∈ s` toward it, so it never reveals that destination and can never win the round through it.

A reveal is permanent for the round. If a later `COLLAPSE` disconnects a revealed destination, it stays revealed.

Reveals only happen from path placement. `COLLAPSE` can never cause a reveal.

---

## 8. Turns

### 8.1 Turn actions

On their turn, the active player performs **exactly one** of these:

| Action | Command | Requirements |
|---|---|---|
| Place a path card | `PLAY_PATH { cardId, x, y, rotation }` | §7.1 |
| Play an action card | `PLAY_ACTION { cardId, target }` | §8.2 |
| Discard one card face-down | `DISCARD { cardId }` | The card is in hand. Always legal on your turn if your hand is not empty. |

**Passing without a card is not allowed.** A player with cards in hand must play or discard. A player with no cards in hand is skipped (§8.4).

### 8.2 Action card validation

Steps 1–3 of §7.1 apply, plus a category check, plus:

| Category | Target payload | Illegal when (error code) |
|---|---|---|
| SABOTAGE | `{ kind:"PLAYER", playerId }` | Target is not an active (non-left) player in this round (`INVALID_TARGET`). That tool is already broken (`TOOL_ALREADY_BROKEN`). |
| REPAIR (single) | `{ kind:"PLAYER", playerId }` | Invalid target. That tool is not broken (`TOOL_NOT_BROKEN`). |
| REPAIR (dual) | `{ kind:"PLAYER", playerId, tool }` | `tool` is not one of the card's two tools (`INVALID_TOOL`). That tool is not broken (`TOOL_NOT_BROKEN`). |
| INSPECT (`SCOUT`) | `{ kind:"DESTINATION", slot }` | `slot ∉ {0,1,2}`, or the slot is already revealed (`DESTINATION_ALREADY_REVEALED`). Scouting a slot you already scouted **is** legal. |
| BOARD (`COLLAPSE`) | `{ kind:"CELL", x, y }` | The cell holds no path card: it is empty, Start or a destination (`INVALID_COLLAPSE_TARGET`). |

A player who is blocked may still play every action category.

### 8.3 Turn resolution (atomic, in this exact order)

1. Validate (§7.1 or §8.2). If it fails, nothing changes and an error code is returned.
2. Remove the card from the actor's hand.
3. Apply the effect:
   - PATH: place the card and run §7.3.
   - ACTION: apply the effect. The played action card goes to the discard pile. Its type and target are public.
   - DISCARD: the card goes to the discard pile face-down. Its type stays hidden.
   - `COLLAPSE`: the removed path card also goes to the discard pile. Its type was already public.
4. Append the public event(s) to the round log (§11).
5. If the round ended in step 3, go to round resolution (§9). **No card is drawn.**
6. **Draw**: if the draw pile is not empty, move the top card into the actor's hand with the next `handPosition` (§6.2).
7. Check exhaustion (§9.2). If it applies, go to round resolution.
8. Advance to the next eligible player (§8.4), increment the turn number and set a new turn deadline (§8.5).
9. Increment the round `stateVersion` by exactly 1.

### 8.4 Next eligible player

From the active seat, step through seats in ascending order with wrap-around. Pick the first player who:

- has not left the game (§10), **and**
- has at least one card in hand.

If no player qualifies, the exhaustion condition (§9.2) holds. The algorithm can never loop forever, because step 7 runs before step 8.

### 8.5 Turn timer and auto-action

| Constant | Value |
|---|---|
| `TURN_TIMEOUT_SECONDS` | 60 |
| `AFK_TURN_TIMEOUT_SECONDS` | 15 (used while the player is flagged AFK) |
| `AFK_THRESHOLD` | 2 consecutive timed-out turns |

- `turnDeadline = turnStartedAt + timeout`, using **server time**. Each turn's `turnStartedAt` is the server time at which the previous transition committed. The deadline is public.
- After the deadline, **any connected room member** may send `RESOLVE_EXPIRED_TURN { expectedTurnNumber, expectedVersion }` (`resolveExpiredTurn`). This includes the active player.
- The server independently checks, in this order:
  1. The referenced game and round are the room's **current** ones and the phase is `ROUND_ACTIVE`. Otherwise `TURN_ALREADY_RESOLVED` or `ROUND_NOT_ACTIVE`.
  2. `turnNumber == expectedTurnNumber`, meaning the turn has not already been resolved. Otherwise `TURN_ALREADY_RESOLVED`.
  3. `serverNow ≥ turnDeadline`. Otherwise `TURN_NOT_EXPIRED`, with the remaining milliseconds.
  4. `stateVersion == expectedVersion`. Otherwise `STALE_STATE`.
- **Auto-action:** discard the card with the **lowest current `handPosition`** (§6.2). Resolution then continues from §8.3 step 4: log, draw, exhaustion check, advance, new deadline, version + 1. All of it happens in the **same** atomic transition. The public log shows "timed out" rather than "discarded".
- Resolution is atomic and idempotent. If several clients ask at the same moment, exactly one state transition succeeds. The others get `TURN_ALREADY_RESOLVED`, which clients treat as a harmless no-op followed by a refetch.
- Turn progression **never depends on a background scheduler**. If no member is connected, the turn simply stays expired. The first member to reconnect resolves it, and the next turn's deadline counts from that moment.
- The consecutive-timeout counter increases. At `AFK_THRESHOLD` the player is flagged AFK and later turns use the short timeout. Any command the player sends successfully clears the AFK flag and resets the counter to 0.

---

## 9. Round end

The round ends when the first of these conditions becomes true. Both are checked only at the points defined in §8.3, so the result is deterministic.

### 9.1 Treasure reached: MINERS win

Triggered by §7.3 step 4.

### 9.2 Exhaustion: DISRUPTORS win

The condition is: the **draw pile is empty AND every non-left player has an empty hand**.

Why this always ends: every turn removes a card from a hand, and once the draw pile is empty no cards come back. Players with empty hands are skipped. The number of turns in a round is therefore bounded by the 66 cards in the deck.

There is no "nobody can win" judgement. The round runs until the treasure is reached or every card has been used.

### 9.3 Game-level early end (abandonment)

- If the number of non-left players drops **below 2** during a round, the round ends immediately with **no winner**. Nobody scores, and the game moves to `GAME_FINISHED` with end reason `INSUFFICIENT_PLAYERS`.
- If fewer than `MIN_PLAYERS` (3) non-left players remain when the next round would start, the game moves to `GAME_FINISHED` with the current totals instead of starting a new round.

### 9.4 Round resolution (atomic, same transaction as the ending command)

1. Set the round phase to `ROUND_ENDED`. Record `winnerFaction ∈ {MINER, DISRUPTOR, NONE}` and `endReason ∈ {TREASURE_REACHED, EXHAUSTED, INSUFFICIENT_PLAYERS}`.
2. Reveal publicly: every player's role, the set-aside role token, and every destination identity.
3. Compute scores (§10) and append the score entries.
4. Set `resultsDeadline = now + 45 s` (`RESULTS_AUTO_ADVANCE_SECONDS`).
5. If this was round `ROUNDS_PER_GAME`, or §9.3 applies, set the game to `GAME_FINISHED` and compute the final ranking (§10.3).

Hands are **not** revealed at round end. Neither is the order of the remaining deck.

---

## 10. Scoring

### 10.1 Per-round points

| Outcome | Who scores | Points |
|---|---|---|
| MINERS win | Each non-left player whose role is MINER | **2** |
| MINERS win | The connector (§7.3), if they are a non-left MINER | **+1** bonus (3 total) |
| DISRUPTORS win, and exactly 1 DISRUPTOR was dealt this round | That DISRUPTOR, if not left | **4** |
| DISRUPTORS win, and 2+ DISRUPTORS were dealt | Each non-left DISRUPTOR | **3** |
| DISRUPTORS win, and 0 DISRUPTORS were dealt (set-aside token was the only one) | Nobody | 0 |
| No winner (`INSUFFICIENT_PLAYERS`) | Nobody | 0 |

- If a DISRUPTOR places the card that reveals the treasure, MINERS still win. Nobody gets the connector bonus.
- Players who have **left** at the moment the round is resolved receive 0 for that round and for every later round.
- Point values live in `src/domain/config/scoring.ts`.

### 10.2 Totals

`total(player) = sum of that player's score entries across the game`.
`roundsWon(player) = number of rounds in which the player scored more than 0 points`.

### 10.3 Final ranking (deterministic)

1. Sort by `total` descending.
2. Break ties by `roundsWon` descending.
3. Players who are still tied **share the rank** (standard competition ranking: 1, 2, 2, 4).
4. The display order inside a shared rank is seat ascending. This is a presentation tie-break only and does not change the rank.

Every player who was seated in the game appears in the final leaderboard. Players who left are shown with a "left" marker.

### 10.4 Game length

There are 3 rounds. The estimated duration is 20–40 minutes, depending on player count and turn speed. The longest possible round is 66 turns, so with a 60 s cap a single round lasts at most 66 minutes in the worst case.

---

## 11. Public event log

Each committed command appends one or more events with a monotonically increasing `seq` per round:

| Event | Public payload |
|---|---|
| `ROUND_STARTED` | round number, starting seat, hand sizes |
| `PATH_PLACED` | actor, typeId, x, y, rotation |
| `DESTINATION_REVEALED` | slot, identity |
| `TOOL_BROKEN` / `TOOL_REPAIRED` | actor, target, tool, card typeId |
| `DESTINATION_SCOUTED` | actor, slot (**not** the identity) |
| `PATH_COLLAPSED` | actor, x, y, removed typeId |
| `CARD_DISCARDED` | actor (**not** the card) |
| `TURN_TIMED_OUT` | actor (**not** the card) |
| `PLAYER_LEFT` | player |
| `ROUND_ENDED` | winner faction, end reason, connector (if any) |

Private events, such as the identity a scout revealed or which card you drew, are only ever written to the actor's private state.

---

## 12. Leaving and rejoining (rules view)

- **Disconnection** is not leaving. A disconnected player keeps their seat, hand and role. Their turns time out (§8.5) until they come back.
- **Leaving** is explicit: the player presses "Leave game" (or a future host kick, which is not in v1). A player who left:
  - has their whole hand moved to the discard pile face-down,
  - is skipped for the rest of the game,
  - still has their role revealed at round end,
  - scores 0 from then on (§10.1),
  - cannot rejoin the same game in v1.
- If the active player leaves, the turn resolves as if it ended: draw is skipped, and steps 7–9 of §8.3 run.

---

## 13. Edge cases (all decided)

| # | Situation | Ruling |
|---|---|---|
| E1 | The draw pile empties partway through a turn | The draw step is skipped. The player continues with a smaller hand. |
| E2 | A blocked player holds only path cards | They must discard (or time out, which discards). |
| E3 | Every non-left player is blocked and the draw pile is empty | Players discard or play actions until the hands are empty, then exhaustion applies. DISRUPTORS win. |
| E4 | A placement connects to two destinations at once, one being the treasure | Both are revealed. MINERS win. |
| E5 | `COLLAPSE` targets a card that is the only link to a revealed EMPTY destination | Allowed. The destination stays revealed but becomes unreachable until it is reconnected. |
| E6 | `COLLAPSE` is played when no path cards are on the board | No legal target exists, so the card can only be discarded. |
| E7 | `SCOUT` is played when every destination is revealed | Impossible: the treasure being revealed ends the round, so at least one hidden destination remains while the round is active. |
| E8 | A player sabotages themselves | Legal. |
| E9 | A player repairs another player's tool | Legal. |
| E10 | The same tool is broken twice | Illegal (`TOOL_ALREADY_BROKEN`). Each tool is a single boolean. |
| E11 | A player wants to place a card that touches only a revealed EMPTY destination | Legal **if** that destination is reached from Start (through a real opening) **and** the new card's side facing it is open. |
| E11a | A card's **closed** side faces a destination | Legal if all ordinary neighbour constraints hold. It does not reach, reveal or win through that destination. |
| E12 | A card is placed next to a disconnected (orphan) path card | Edges must still match the orphan (rule 9). The new card must still connect to Start (rule 10). |
| E13 | A player has 0 cards but the draw pile is not empty | Cannot happen. Players draw after every turn. |
| E14 | The active player disconnects | The timer keeps running. When it expires, the auto-discard happens (§8.5). |
| E15 | No DISRUPTOR was dealt | The round plays normally. If the miners fail, nobody scores. |
| E16 | The round ends and the game continues | Moving to the next round is triggered by the host, or by any member once `resultsDeadline` passes. |

---

## 14. Terminology

Bulgarian public terms are an owner decision (2026-10-06): the product is **«Саботьор»**, the factions are **джудже / джуджета** and **саботьор / саботьори**, and the board is made of **тунел / тунели**. Internal identifiers stay unchanged.

| Internal ID | BG (public) | EN working term |
|---|---|---|
| `MINER` | Джудже (мн. джуджета) | Dwarf |
| `DISRUPTOR` | Саботьор (мн. саботьори) | Saboteur |
| `TREASURE` | Златна жила | Gold vein |
| `EMPTY` | Празна жила | Empty vein |
| Start | Вход | Entrance |
| `DRILL` / `LAMP` / `ROPE` | Свредел / Лампа / Въже | Drill / Lamp / Rope |
| SABOTAGE / REPAIR | Повреда / Поправка | Breakdown / Fix |
| `SCOUT` | Разузнаване | Survey |
| `COLLAPSE` | Срутване | Cave-in |

All rule text shown to players will be written independently in our own words (see PRODUCT_SPEC.md §9).

---

## Changelog

- v1.0 (2026-10-06): Initial specification.
- v1.1 (2026-10-06): Owner-approved finalisation:
  - Destinations never make a placement illegal (§4.6).
  - Hands use a server-owned `handPosition` (§6.2).
  - A timeout discards the card with the lowest `handPosition`.
- v1.2 (2026-10-06): Owner decision: destinations are not connectivity wildcards. They still never constrain placement, but they connect, are reached, are revealed and give the gold victory only through a neighbouring card's **open** facing side (§4.6, §7.3). The rendering draws mouths only on connected sides.
  - Expired turns are resolved by a member's `RESOLVE_EXPIRED_TURN` request that the server verifies, never by a scheduler (§8.5).
