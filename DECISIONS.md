# DECISIONS

Per the brief's §20: decide everything not explicitly settled, and record the
choice here. This file covers Phase 1 (the engine, `packages/engine`) only —
it'll grow as later phases land.

## Working name

Kept **NONET** — no better name came to mind; revisit once there's a logo/app icon to react to.

## Board representation: single bigint, not two bigints / Uint32Array(3)

§3 suggests "two `BigInt`s or a pair of `Uint32Array(3)` bitboards." I used a
single bigint bitmask (bit `row*9+col`) instead — it holds all 81 bits
natively, is simpler to reason about and serialize (e.g. for the replay hash
and eventually the `runs.seed`/board snapshots), and BigInt bitwise ops are
"a couple of ops" either way.

This did initially cost real performance: the naive version recomputed each
piece's placement mask (a shift+OR loop over `piece.cells`) on every
`canPlace`/`legalPlacements` call, and the solvability DFS in `deal.ts` calls
those thousands of times per `dealHand`. Measured worst case was ~12ms against
the 3ms budget (§16). Fix: `board.ts` now precomputes every catalogue piece's
mask at every `(row, col)` once at module load (`PIECE_MASK_TABLE`), turning
the hot-path check into an array lookup + one bigint AND + one compare.
`deal.ts` also shares one memoization cache across all 40 retry attempts
within a single `dealHand` call (the board is identical across attempts, so
many `(board, remaining-piece-set)` subproblems recur). Measured worst case
after both fixes: ~2ms (see `packages/engine/test/perf.test.ts` and
`scripts/perf-check.ts`). If a real device profile later shows this isn't
enough, the two-`Uint32Array`-word representation is the next lever — it
trades BigInt's arbitrary-precision overhead for native 32-bit ops.

## Fill power-up: it ADDS cells, not removes them

This is the one place the brief's wording is genuinely ambiguous, so it gets
a full explanation. §7's table says fill "flood-fills the 4-connected region
of empty cells... then resolve clears," and the guard-rail text warns that an
unbounded fill "becomes an instant-win button." Read literally, "flood-fill an
empty region" could mean either (a) clear/remove that empty region — which is
a no-op, since removing empty cells does nothing — or (b) fill those cells in
(mark them occupied).

Implemented (b): `applyFill` marks the flood-filled empty region as *filled*,
then runs the normal clear-detection pass, so completing a row/column/block
via the fill triggers a real clear. This is the only reading that makes the
"instant-win button" warning make sense (filling in a huge empty region on a
near-empty board would complete most of the board's rows/cols/blocks at
once) and the only one where "a fill that completes three rows cascades
properly" is a meaningful sentence rather than a impossibility. `rocket` and
`bomb`, by contrast, are pure removals (§7's own description: "clear one
entire row or column" / "clear the full row and column") — for those, running
the clear-detection pass afterward is architectural uniformity, not a load-
bearing mechanic (removing cells can't newly complete a different unit), so
their `unitsCleared` is the fixed count of units they target (1 and 2
respectively) rather than whatever `resolveClears` finds (which will always
be 0 for them).

If this reading is wrong, it's a one-file fix (`powerups.ts`'s `applyFill` +
`reduce.ts`'s `fill` case) — flag it and I'll flip it.

## Power-up combo multiplier reads the *current* combo level, unincremented

§6 says power-up clears score at half rate; §7 adds "`comboLevel` is left
untouched — neither incremented nor reset." That's clear for the *state*
transition, but doesn't say what multiplier to apply to *this* clear. I read
it as: the multiplier formula still runs, using whatever combo level already
stood (from the player's last placement streak), just without bumping it
afterward. A corollary: at combo level 0 (no active streak — e.g. very start
of a run, or right after a non-clearing placement), the multiplier reads as a
neutral x1.0 floor rather than an undefined/negative value — see
`comboMultiplierX10`'s `Math.max(level, 1)` guard in `score.ts`. Without that
floor, a power-up clear at combo level 0 would score *below* the stated 50%
rate, which contradicts "scores at 50%" as a flat statement.

## Action log field names: `r`/`c` kept, `args` flattened into typed fields

§9's example action shape is `{ t, type: 'place', slot, r, c }` and
`{ t, type: 'powerup', kind, args }`. Kept `r`/`c` verbatim. For power-ups,
`args` became a discriminated union on `kind` with each kind's own typed
fields at the top level (`reduce.ts`'s `PowerupAction`) instead of a generic
untyped bag — same wire shape in spirit, but the compiler catches a
mismatched `kind`/args combination instead of it surfacing only at replay
time.

## Illegal actions throw; `FillRegionTooLargeError` doesn't

`reduce()` throws on anything a legitimate client could never produce
(placing into a used slot, out-of-bounds/colliding placement, pencil on an
empty cell). `replay()` catches these and reports `valid: false, reason:
"illegal_action"` — by construction this should only ever happen on a
tampered or desynced log, i.e. it's the anti-cheat signal.

`FillRegionTooLargeError` is deliberately not treated the same way: refusing
an oversized fill is an expected, non-cheating outcome (§7's "refuse and
refund the tap... show why"). A legitimate client should never log this
action in the first place (no state changed, nothing to verify), but if one
somehow reaches `replay()`, it's caught by the same generic handler and
reported as `illegal_action` too — a tampered log containing one is exactly
as suspicious as any other illegal action.

## Superhuman-APM check is a policy knob, not a precise spec

§9 asks to "reject superhuman APM, e.g. > 8 actions/s sustained" without
defining "sustained." Implemented as a sliding 3-second window
(`SUSTAINED_WINDOW_MS`) — more than `8 * 3 = 24` actions in any 3-second span
flags the run. Both constants are exported from `replay.ts` and are exactly
the kind of tunable the brief invites revisiting (§20) once real play data
exists.

## Piece catalogue naming (corners) and diagonal pieces

The brief names small/big corner pieces (`L3_*`, `L5_*`) and diagonals
(`D2_*`, `D3_*`) but doesn't specify their exact cell layouts. Corners are
named by their "elbow" (the cell touching both arms) — `L3_NW` has its elbow
at the top-left of its 2x2 box, etc.; `L5_*` are two 3-length arms sharing a
corner in a 3x3 box. Diagonals are disconnected cells along a 2x2 or 3x3
box's diagonal (`D2_A`/`D3_A` = top-left-to-bottom-right, `D2_B`/`D3_B` =
top-right-to-bottom-left) — genre-standard "spice" pieces that can't be
reached by sliding, only exact placement.

## Golden-replay corpus generation

`packages/engine/scripts/generate-golden.ts` (run via `pnpm exec tsx
scripts/generate-golden.ts` from `packages/engine`) drives a deterministic
"place the first piece at the first legal position" bot
(`test/helpers/autoplay.ts`) across 20 fixed seeds and freezes the resulting
scores/hashes into `test/fixtures/golden-replays.json`. `test/golden-
replays.test.ts` replays each fixture and asserts an exact match — any future
engine change that alters these values will fail loudly and must be a
deliberate, reviewed break, regenerated and diffed by hand, not silently
re-blessed.

## Not yet built (per §19's build order)

Steps 1-5 are done (engine, playable slice, backend+auth+leaderboards,
power-ups + consume-at-use inventory, economy/Stars/shop/revive — see the
Phase 5 section below). Step 6 (polish) and step 7 (Gram/TON stubs) are
next.

---

# Phase 3: backend + auth + Docker (`apps/api`, `apps/bot`, `docker/`)

## `packages/shared`'s action schema is hand-mirrored, not derived, from the engine's

`@nonet/shared`'s `actionSchema` (zod) duplicates `@nonet/engine`'s `Action`
union by hand rather than generating one from the other. The engine is
contractually dependency-free — it can't import zod — and shared needs a
*runtime* validator, not just the compile-time type `@nonet/engine` already
exports. Cheap to keep in sync (the action shape is small and stable); if it
drifts, a checkpoint/finish payload gets rejected at the zod layer loudly,
not silently miscompiled somewhere.

## Postgres `seed` column is `text` (hex), not `bytea`

§11 specifies `seed bytea`. Drizzle's pg-core doesn't have a first-class
`bytea` column helper (it'd need a `customType()`), and the seed only ever
needs to be a fixed-length hex string handed to the engine's
`createRngFromHex`/`replay(seed: Uint8Array, ...)` — storing it as `text`
(32 hex chars) is functionally identical, simpler to log/debug, and avoids
hand-rolling a binary column type for no real benefit at this scale.

## initData HMAC direction verified against current Telegram docs, not the brief's shorthand

§12 writes the secret-key formula as `HMAC_SHA256("WebAppData", BOT_TOKEN)`,
which is ambiguous about which argument is the HMAC *key* vs the *message*.
Implemented the documented, unchanged algorithm from
`core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app`:
key = `"WebAppData"`, message = the bot token; then that digest becomes the
key for a second HMAC over the sorted `key=value` data-check-string. Got the
order backwards once while writing the test helper (`test/helpers/telegram.ts`)
and the round-trip test caught it immediately — which is exactly why that
helper re-implements the algorithm independently rather than importing
`validateInitData` and asserting it agrees with itself.

## Run tokens are JWTs carrying `runId`, not a second DB-backed token table

§9/§10 call for a "signed short-lived run token" from `/api/run/start`.
Implemented as a JWT (`{ sub: userId, runId }`, `RUN_TOKEN_TTL_SECONDS` TTL)
verified by a second Fastify preHandler (`authenticateRun`) that separately
checks the body's `runId` matches the token's — no extra table, no extra
round trip, and it's self-revoking (expires on its own). A real revocation
list would only matter if we needed to invalidate a run token before its TTL
elapses, which nothing in Phase 3 requires.

## Leaderboard: best-score-per-user via a raw `DISTINCT ON`-style query

A leaderboard should show each player's best run, not every run — drizzle's
query builder doesn't have a clean way to express "top row per group," so
`leaderboard.ts` drops to one raw parameterised SQL query (`row_number() over
(partition by user_id order by score desc)`) rather than force-fitting the
builder. `scope=daily/weekly` use `now() - interval` rolling windows, not
calendar-day/ISO-week boundaries — simpler, and "daily" reads more naturally
as "in the last 24h" for a casual mobile game anyway. `around` (page around
the requester's own rank) is accepted by the schema but not implemented — a
nice-to-have deferred past this phase, noted in the route so it isn't
silently wrong.

## Rank on `/api/run/finish` is computed against the full Open (all-time) board

The response schema's `rank` field doesn't specify which leaderboard scope it
ranks against. Implemented as "count of verified runs with a strictly higher
score, all-time, any power-up usage, +1" — the simplest well-defined answer.
`null` when the run failed verification (excluded from every board, so no
rank is meaningful).

## `apps/bot` is a thin webhook skeleton, not the full economy bot

Phase 3's brief scope is auth + run lifecycle + leaderboards — Stars
invoices, `pre_checkout_query`/`successful_payment` handling, and the shop
are step 5. `apps/bot` currently only answers `/start` with a "Play NONET"
button (forwarding `start_param` as `startapp` for deep links) and verifies
`X-Telegram-Bot-Api-Secret-Token` on the webhook route via grammY's own
`secretToken` option — enough to make `docker-compose.yml`'s four-service
shape real today rather than a placeholder.

## api/bot Docker images: esbuild-bundled, not `tsc`-compiled

`@nonet/engine` and `@nonet/shared` intentionally point their `main`/`types`
at TypeScript source, not a build artifact — great for dev (tsx/vite/vitest
all transpile on the fly, so an engine edit is instantly visible everywhere
that imports it) but fatal for a production image, where a plain `node
dist/index.js` cannot execute a `.ts` file just because some package's
`main` field points at one. Rather than restructure those packages' exports
to always point at a compiled `dist/` (which would cost the instant-reload
dev experience), `apps/api`/`apps/bot` each gained a `build.mjs` that bundles
their entry point(s) with esbuild: real npm dependencies (fastify,
drizzle-orm, postgres, grammy, ...) stay external and get installed normally
in the runtime image, while the workspace packages' source is traced and
inlined directly into the bundle, so the shipped `dist/index.js` has zero
runtime dependency on `@nonet/engine`/`@nonet/shared` existing as packages at
all. Verified end-to-end outside Docker (no registry access in this sandbox —
see below): built both bundles, ran `node dist/db/migrate.js` against a real
local Postgres, then `node dist/index.js` and `node dist/bot/index.js`, and
hit their health endpoints successfully.

## Docker images: config-validated, not build-validated, in this sandbox

This sandbox's network policy blocks Docker Hub image pulls outright (a
`docker pull node:22-slim` 403s at the registry CDN — confirmed, not
retried, per this environment's own instructions not to route around a
policy denial). `docker compose config` fully parses and resolves
`docker-compose.yml` (interpolation, `env_file`, healthchecks, the `Nonet`
container name), and every application-level artifact the images would run
was independently verified outside a container (see above and Phase 2's
notes) — but nobody has actually built `docker/*.Dockerfile` end-to-end or
started the four-container stack. Worth a real `docker compose up --build`
on a machine with normal registry access before trusting this in production.

## Game container is named `Nonet`

Per explicit request: `docker-compose.yml`'s `web` service (nginx serving the
built SPA — "the game" from a player's perspective) is set to
`container_name: Nonet`, matching the repository's name. The other three
services use lowercase, hyphenated names (`nonet-api`, `nonet-bot`,
`nonet-postgres`) for consistency with typical Docker naming conventions,
since only the game container's name was specified.

---

# Phase 2: playable slice (`apps/web`)

No backend, no power-ups, no Telegram SDK yet (§19 step 2 scope) — just
board → drag-and-drop → clear → game over → local score, entirely client-side.

## Drag implementation: pointer events, not native HTML5 DnD

Native drag-and-drop doesn't handle touch well and fights CSS transforms;
`useDragPlacement` instead does the whole gesture with raw `pointermove`/
`pointerup`/`pointercancel` listeners attached to `window` for the duration of
one drag, reading/writing the Zustand store via `getState()`/`setState()`
inside the drag-session closures rather than through the reactive hook — a
single continuous gesture should never operate on a snapshot that's gone
stale mid-drag.

## Placement centers the piece under the pointer, then snaps and clamps

The dragged piece's bounding-box center tracks the pointer continuously; the
*board* ghost separately rounds that to the nearest cell and clamps into
`[0, 9-piece.h]`/`[0, 9-piece.w]`. A practical consequence: dragging past the
board edge doesn't refuse the drop, it clamps to the nearest position that's
still fully on-board (still subject to the normal collision check). This
reads as more forgiving/mobile-friendly than a hard refusal at the boundary,
and doesn't change what's legal — `canPlace` from the engine is still the
only thing that decides whether a drop actually commits.

## Cosmetic per-cell "piece family" colour is tracked outside the engine

§15 wants each piece's cell-count family colour held constant across a run,
but the engine's board is an opaque bitmask with no per-cell metadata (by
design — it's what keeps clear detection a few bitwise ops). `gameStore.ts`
keeps a parallel `cellFamilies: Uint8Array(81)` purely for rendering, updated
in lockstep with every placement/clear the store applies. It's derived,
never authoritative, and if it ever drifts from `game.board` that's a
rendering bug, not a rules bug — the engine's own tests don't know it exists.

## Animation timing: clear stagger measured in engine coordinates

The clear animation staggers outward from the triggering placement using
Chebyshev distance (`max(|dr|, |dc|)`) at 12ms/cell (§15), computed from the
`ClearEvent.originRow/originCol` the store records at placement time — capped
by board geometry at 8 cells away, so worst case ≈ 96ms of stagger + 260ms of
per-cell animation, comfortably under the 350ms ceiling.

## Dev-only store escape hatch

`main.tsx` attaches the Zustand store to `window.__nonetStore` behind
`import.meta.env.DEV`, purely so a state like "game over" can be forced from
a console/test script without playing an entire run first — real hands are
randomly dealt, so scripting a genuine loss deterministically isn't
practical. Dead-code-eliminated from production builds by Vite's static
`import.meta.env.DEV` replacement; nothing shipped reads it.

## Verified manually (no automated UI tests yet, per §1: "UI tests are optional")

Ran the dev server behind a headless Chromium (Playwright) and exercised:
piece pickup (scale-up animation), ghost preview (legal=blue tint,
illegal/colliding=red tint), snapping, drop commit, score update, hand
refill after all 3 slots empty, collision rejection (score unchanged, piece
returned to hand), and the game-over overlay + restart flow (forced via the
debug hook above, since natural game-over is seed-dependent). Production
build: 67 KB JS / 2 KB CSS gzipped — both comfortably under the §16 budgets
(120 KB / 12 KB).

---

# Phase 4: power-ups (targeting UI + consume-at-use inventory)

§19 step 4 bundles three things together: the engine's power-ups (done in
Phase 1), their targeting UI, and "the consume-at-use inventory flow." That
last part can't be faked — it only means something against a real backend —
so this phase is also where `apps/web` stopped being local-only and started
actually talking to `apps/api` (session, run start/checkpoint/finish,
inventory/consume). That integration reused Phase 3's endpoints as-is; the
only backend additions were the consume endpoint itself, the welcome gift,
and consumeToken verification at finish.

## `consumeToken` is the `inventory_ledger` row id, not a signed token

§9 asks for a `consumeToken` from `/api/inventory/consume` that "must appear
in the corresponding action in the log." Rather than mint a JWT or random
opaque string (which would need its own one-time-use tracking table),
the token *is* the ledger row's own `bigserial` id, returned as a string.
It's unforgeable — an attacker can't produce a valid id without this
endpoint having actually decremented their balance — and naturally
one-time-use: `run/finish`'s `validateConsumeTokens` (services/inventory.ts)
just checks that no id is claimed by more than one action in the log, and
that each claimed id's `(user_id, run_id, reason='use', item)` matches what
the action says it is. No extra table, no extra crypto, and the check is a
single indexed `WHERE id = ANY(...)` query.

## `consumeToken` lives on the wire action, not the engine's `Action` type

`@nonet/engine`'s `Action` union (used by `reduce`/`replay`) has no
`consumeToken` field — the engine doesn't know inventory exists, by design.
`@nonet/shared`'s `actionSchema` adds `consumeToken` to each power-up
variant; the API passes the *shared* action straight into `reduce`/`replay`
anyway, since TypeScript structural typing allows a value with extra fields
to satisfy a narrower parameter type. `validateConsumeTokens` is the one
place that actually reads the extra field. This means an engine change to
`Action` and a shared-schema change to `actionSchema` are two edits, not
one — accepted for the same reason `packages/shared`'s hand-mirrored schema
is (see Phase 3): the engine has to stay zod-free.

## Welcome gift is the only source of inventory right now

There's no economy yet (§19 step 5), so without something granting items
there'd be nothing to consume and no way to exercise this phase's actual
subject. Every brand-new user gets a fixed starter kit (3 pencil, 3 eraser,
2 rocket, 1 bomb, 1 fill — `services/inventory.ts`'s `WELCOME_GIFT`) recorded
as a normal `reason: 'gift'` ledger entry, granted exactly once (detected via
`INSERT ... ON CONFLICT DO NOTHING RETURNING id` on the user row, not a
separate — racy — existence check). These numbers are arbitrary and
explicitly not a drop-rate decision (§8's real earning loop is milestone
drops + a daily gift, both step 5) — just enough to click every button once
during review.

## Dev-only session bypass: `POST /api/session/dev`

There's no real Telegram WebView in a browser tab, so `apps/web` has no way
to obtain genuine `initData` outside Telegram itself. Gated behind
`ALLOW_DEV_SESSION` (an explicit opt-in env var, deliberately *not* just
`NODE_ENV !== 'production'`, so it can't be live by an unset-env-var
accident), `/api/session/dev` mints a session for an arbitrary user id with
no initData check at all. The route isn't even registered unless the flag is
set — confirmed by a test asserting it 404s by default — rather than
existing-but-rejecting, so there's no code path in a production process that
even parses the bypass request shape. The client's fallback
(`getOrCreateDevUserId` in `apps/web`) picks a random id once and persists it
in `localStorage`, so a dev session's inventory/progress survives reloads
instead of minting a fresh user every refresh.

## Board-targeting power-ups share one press-drag-release interaction

Pencil, eraser, bomb, and fill all follow the same gesture (`usePowerupTargeting`):
arm from the inventory bar, press on the board, see a live preview, release
to commit. Only the *preview shape* differs per kind
(`utils/powerupPreview.ts`: one cell / a 2x2 window / a cross / the actual
flood-filled region), which is what §7's table describes for each of them
anyway — modeling it as one hook with a per-kind pure preview function beats
four near-identical hooks. Rocket is the one genuine exception: §7 specifies
36 fixed gutter slots around the board, not a targeted drag, so it's a
separate component (`RocketGutters`) with a plain tap-to-fire per slot.

## Fill's region-too-large refusal is computed twice, deliberately

The client pre-checks the region size locally (`floodFillEmptyRegion`) before
ever calling `/api/inventory/consume` — a refusal must cost nothing (§7:
"without consuming the item"), and the cheapest way to guarantee that is to
never make the network call in the first place when the local engine
already knows the answer. The *live preview* (during the press-drag, before
release) also runs this same check continuously so the refusal message
("Region too large (N cells) — pick a smaller pocket") is visible while
aiming, not just after a failed commit. Both call the same pure function
(`computeTargetPreview`); there's no separate "authoritative" version to
drift from the preview.

One UI bug this surfaced and fixed during manual testing: the refusal
message was clearing itself the instant the pointer lifted (`targeting`
resets to `null` on release), before it was readable. It now persists for a
fixed ~2.2s after release when the last live preview was a too-large fill,
via a ref tracking the last non-null targeting state — see `App.tsx`'s
`lastTargetingRef`.

## Fill's clear animation needs its own mask computation

Rocket/bomb/pencil/eraser all *remove* cells, so `game.board & ~next.board`
(bits that were set before and are clear after) is exactly the set of cells
to animate away. Fill is the odd one out — it can fill cells in that were
never set in `game.board` and get them cleared in the same action, which
that simple diff can't see (both before and after, they read as 0). The
store's `computeFillClearedMask` instead replays fill's own two engine steps
(`applyFill` then `resolveClears`) to get the real cleared mask, mirroring
exactly what `reduce.ts`'s `powerup`/`fill` case does internally.

## Non-fill power-up failures don't distinguish *why* to the UI

`applyPowerupAction` (used by pencil/eraser/bomb/rocket) returns a plain
`boolean` — it doesn't surface "insufficient inventory" vs. "network error"
the way fill's `applyFillPowerup` does. In practice the inventory-bar button
is already disabled at qty 0, so a server-side insufficient-inventory
response here is only reachable via a genuine race (e.g. two tabs), not a
normal click — not worth a richer error-reason plumbing for step 4's scope.
Fill gets the richer `ConsumeFailureReason` return specifically because its
*expected*, non-racy refusal (region too large) needed a real message.

## Verified end-to-end against a live API + Postgres, including a fill success

Ran the real dev server stack (`ALLOW_DEV_SESSION=true` api + Vite web) behind
headless Chromium and drove every power-up through the actual UI: pencil
(tap a filled cell), eraser (2x2 drag), bomb (cross preview), rocket (all 36
gutter slots render; firing one clears correctly), and fill's refusal path
(region too large, not consumed, message persists). A genuine fill
*success* needed a bounded empty pocket that random piece placement didn't
reliably produce in a short session, so that one path was exercised by
forcing a board state through the dev-only `window.__nonetStore` hook (see
Phase 2) rather than fighting the dealer's RNG — the resulting massive
clear + perfect-clear bonus fired exactly as the already-existing engine
unit tests predict. That run was intentionally never submitted to
`run/finish` (the forced board never went through a logged action, so its
replay would correctly fail verification — which is the right outcome, not
a bug). Also reconfirmed collision rejection and score accounting still
work after the store rewrite. 134 tests pass across the workspace
(109 engine + 25 api); production build stays at 85 KB JS / 2.4 KB CSS
gzipped, still under the §16 budgets.

# Phase 5: economy (drops, shop, Stars, revive)

§19 step 5's four pieces — milestone drops, the shop, the Stars invoice
flow, and revive — all hang off the same primitive: a data-driven
`shop_skus` table and a `purchases` row per invoice. Revive isn't its own
mechanism so much as `sku='revive'` with a `runId` attached and empty
`contents` (it re-opens a run instead of granting an item).

## `purchases.telegram_payment_charge_id` is nullable, contradicting §11's literal spec

§11 specifies `telegram_payment_charge_id text UNIQUE NOT NULL`, but §13's
own flow requires persisting a `pending` purchase row *before* a charge id
exists — payment hasn't happened yet when `/api/shop/invoice` creates it.
Those two requirements can't both hold. Made the column nullable and kept
it `UNIQUE`: Postgres treats every `NULL` as distinct from every other
`NULL`, so any number of pending purchases can coexist, and the constraint
still does its real job — preventing the *same paid charge* from being
processed twice — the moment a row transitions to `paid` with a real id.

## Revive's `consumeToken` reuses the existing pattern, against a second table

Phase 4 already solved "prove this token was really issued, to this run,
without a signed token" for power-ups, by making the consumeToken the
`inventory_ledger` row id. Revive isn't an inventory item, so it has no
ledger row — but the same shape of proof exists in `purchases`: a paid
`sku='revive'` row tied to this `runId`. `validateConsumeTokens`
(services/inventory.ts) now checks both action kinds in one pass, with a
regex UUID-format check on revive tokens before they ever reach a `WHERE id
= ANY(...)` query against a `uuid` column — a fabricated non-UUID string
would otherwise make Postgres throw a cast error instead of just finding no
rows, which is the wrong failure mode for "tampered log," not the right one.

## The bot service never touches Postgres — two internal HTTP endpoints instead

`apps/bot` could have imported the Drizzle schema directly, but that
couples two independently-deployable services to the same DB migrations.
Instead it calls two tiny `/api/internal/*` routes on the api service,
authenticated by a shared secret header (`X-Internal-Secret`) and also
denied at the nginx edge as defense in depth (docker/nginx/nginx.conf) —
`validate` for `pre_checkout_query` (must answer within 10s) and
`stars-payment` for `successful_payment` (does the actual crediting).

## `successful_payment`'s handler deliberately has no try/catch

Verified directly against grammY's compiled source: `webhookCallback` calls
`bot.handleUpdate()` (singular), which does **not** invoke the registered
`bot.catch()` handler — that only fires from `handleUpdates()` (the
batch/polling path). So a throw inside the `successful_payment` handler
propagates out as a rejected promise, Fastify turns that into a 500, and
Telegram retries the webhook delivery later. Since
`/api/internal/stars-payment` is idempotent on the charge id, that retry is
always safe — swallowing the error here would instead silently strand a
paid purchase with no automatic recovery. This is the one place in the bot
that intentionally lets an error escape uncaught.

## The "realtime nudge" is just a bot reply with a button

§13 asks for pushing an update to an open Mini App once a payment lands.
There's no push channel into a live WebView — so `successful_payment`'s
handler sends a normal text message with an inline "▶️ Open NONET" button,
which is the practical equivalent given the platform.

## Milestone drops and the daily gift both use the same race-safe "first grant" pattern

`INSERT ... ON CONFLICT DO NOTHING ... RETURNING` lets each caller find out,
atomically, whether *it* was the one that actually inserted the row — only
then does it proceed to roll a drop / grant a gift. This is the same
pattern Phase 4's welcome gift already used, now reused twice more: the
daily gift keys on `(user_id, day)`, and milestone grants key on
`(run_id, ref)` where `ref = 'milestone-N'`. No separate
check-then-insert race window either time.

## Drop-rate constants are a placeholder, per §20

`services/drops.ts`'s weighted pool (`nothing` 30, pencil 30, eraser 21,
rocket 12, bomb 6, fill 1) plus a hard cap (15) and a "well-stocked" bonus
toward `nothing` (+15 per item at/above 8) are reasonable-looking numbers
invented for playability, not a real economy decision — §20 explicitly
defers exact drop rates to "propose the new number." Same for the daily
gift's weights (no `nothing` option, since a daily gift that does nothing
feels bad) and its 1-in-7-day streak bonus.

## Finishing a run is deferred until the player actually leaves the game-over screen

Originally `gameStore.ts`'s `maybeFinish` fired `/api/run/finish` the
instant `game.status` became `"gameover"` — fine before revive existed, but
fatal once it did: by the time a player could tap "Revive," the run would
already be finalized server-side (`endedAt` set), and `/api/shop/invoice`
requires the run still be open (`endedAt is null`). The call is now
`finishRun()`, triggered only from `newRun()` (i.e. the player chose "Play
again" over reviving) — fire-and-forget, same as before, just moved to a
later trigger point. A player who closes the app on the game-over screen
without choosing either option leaves the run genuinely unfinished; the
next `/api/session` call resumes it as `activeRun` exactly as if they'd
checkpointed mid-game, which is the correct, unsurprising behavior — no
timeout or forced-finish was added for this, since the brief doesn't call
for one and the run is unranked either way until finished.

## Revive is offered only from the game-over screen, not the general shop

The shop screen (`ShopOverlay.tsx`) fetches `/api/shop` and filters out
`sku === "revive"` before rendering — buying a revive without a specific
dead run to attach it to doesn't mean anything server-side
(`/api/shop/invoice` 400s a revive request with no `runId`), so it's only
offered contextually, as a button on `GameOverOverlay`, which always has
the current `runId` in scope.

## No dedicated "refresh inventory" endpoint

After a non-revive shop purchase, the client needs to eventually see the
new items, but Telegram's `openInvoice` "paid" callback is optimistic —
crediting only actually happens once the bot's `successful_payment` webhook
lands, which can lag the callback by a moment. Rather than add a new
`GET /api/inventory` route, `refreshInventory()` just re-calls
`postSession`/`postDevSession` — already idempotent per calendar day for
the gift it may (re-)grant — and takes the fresh `inventory` off the
response. `ShopOverlay` calls it ~1.5s after a "paid" result, giving the
webhook a moment to land first.

## Bug found during manual verification: the Telegram Web App SDK script was never loaded

`apps/web/index.html` never included
`<script src="https://telegram.org/js/telegram-web-app.js">` — a Phase
2/3 scaffolding gap, not a Phase 5 one, but only surfaced now via testing
inside a real Telegram client. Without it, `window.Telegram.WebApp` doesn't
exist at all (not even as an empty stub), so `getTelegramInitData()` always
returned `null` and boot failed with "no Telegram initData available
outside a Telegram WebView" — even though the app genuinely was running
inside Telegram's Mini App WebView, which does inject `initData` once the
SDK script defines `window.Telegram.WebApp` to receive it. Fixed by adding
the script tag; every previous manual verification pass had used
`ALLOW_DEV_SESSION`/`postDevSession` in a plain browser, which never
exercises this path, so it went unnoticed until real-device testing.

## Test-only: a greedy autoplay bot, alongside the existing naive one

`autoplay()` (first-legal-position scan) is deliberately dumb and stalls
into a low score fast — great for cheaply reaching a real `gameover` state,
useless for milestone tests that need a genuinely-played run to legitimately
clear score 1000+ against a truly random, server-issued seed (only ~2% of
random seeds hit 1000 under the naive bot within a generous action budget).
Added `autoplayGreedy` (picks whichever legal placement scores the most
that turn) alongside it rather than replacing it — raises the hit rate to
roughly 3-in-4 seeds, cheaply, while every existing test that depended on
the naive bot's specific (slower, lower-scoring) behavior keeps working
unchanged. `continueGreedy` extracts the shared step logic so a test can
also resume greedy play from an arbitrary mid-run state — used to keep
playing after a revive resets the board, to build a legitimate log for
`/api/run/finish`.

## Verified end-to-end against a live API + Postgres, revive and shop included

Ran the real dev server stack and drove the game-over screen through
headless Chromium: forced a game-over via the dev store hook, confirmed
both "Revive" and "Play again" render and are reachable, confirmed a revive
attempt correctly calls `/api/shop/invoice` and surfaces a graceful failure
hint (this sandbox can't reach `api.telegram.org` to mint a real invoice —
the one thing genuinely untestable without live Telegram Stars), and
confirmed "Play again" correctly finishes the forced run
(`/api/run/finish` → 200) and starts a fresh one. Separately opened the
shop overlay, confirmed it lists all seeded SKUs except `revive`, and
confirmed a purchase attempt fails the same graceful way. Backend-side: 48
API integration tests across 7 files (shop, internal payment webhook
idempotency + crediting, milestone drops, a full paid-revive-through-
`run/finish` flow, and a rejected-unpaid-revive-token case) plus the
existing 111 engine tests all pass.

# Post-Phase-5 fixes (pre-step-6 polish, user-reported)

Before starting §19 step 6 ("polish"), the user reported five concrete
problems from actually playing the deployed app. All five turned out to be
real, addressable gaps rather than matters of taste, so they're fixed here
rather than folded into step 6's own (separate, still-open) polish pass.

## The board "jumped" because the hand tray's height depended on which pieces were dealt

`PieceView` sizes its root element to the actual piece (`w`/`h` in cells),
so a taller piece (a 5-cell line, say) made `HandTray`'s slot — and so the
whole tray — taller than a hand of small pieces did. Since `App.tsx`'s
column layout gives the board a `flex: 1` region between the fixed-height
score HUD and the tray, a tray that changes height every time a new hand is
dealt reflows that middle region, visibly shifting the board's vertical
position. Fixed by reserving a `min-height` on `.tray` equal to the
catalogue's tallest possible piece dimension (`MAX_PIECE_DIM`, computed
once from `PIECE_CATALOGUE` rather than hardcoded, so it can't silently go
stale if pieces are added later) times the tray's per-cell scale — the tray
is now always at least as tall as its tallest possible content, regardless
of which specific hand is showing. Verified by scripting 29 real
placements (spanning ~10 hand deals) through headless Chromium and
confirming the board's bounding rect never moved by a single pixel.

## Difficulty didn't actually escalate at high score — the "hard" tier's requirement was being quietly undercut by its own weighting

`deal.ts` already had a three-tier solvability requirement (§5): gentle
guarantees all 3 dealt pieces are placeable, normal guarantees 2, hard
guarantees only 1. That's a real difficulty knob — a hand with
`maxPlaceable() <= 1` on a crowded board means the *other* two pieces are
provably unplaceable regardless of order, which (since a fresh hand is only
dealt once all 3 slots are empty) can end the run right after the next
placement. But `adaptiveWeight`'s separate crowded-board protection (nerf
large pieces' draw odds once the board is >60% full) applied at *full
strength regardless of tier* — so a crowded board almost never actually
drew the large piece that would make a low-requirement hand truly
dangerous, and "hard" rarely produced a hand riskier than "gentle" in
practice. Fixed by scaling that protection down with tier, and — because
simulation showed the rare 5-cell pieces alone are too sparse in the
catalogue to noticeably shift the drawn distribution — by making `hard`
actively *invert* the effect (boost, not just stop protecting, both the
rare 5-cell and the much more common 4-cell pieces) rather than merely
removing gentle's protection.

Verified empirically, not just by intent: a script sweeping `dealHand`
across thousands of trials at a fixed 0.68 board fill showed the
"immediately fatal" hand rate (`maxPlaceable <= 1`) at hard tier moving from
0% (gentle, unchanged) and ~3.6% (hard, before this change) to ~5.2% (hard,
after) — a real, measurable increase, not just a plausible-sounding
rationale. Two new engine tests pin the *direction* of this (large pieces
must be favoured, not penalised, at hard tier; a crowded board must deal a
large piece meaningfully more often at hard than at gentle) without pinning
an exact ratio, so future weight retuning doesn't make the tests brittle.

## Leaderboard and profile screens: the backend already existed, the frontend never called it

`GET /api/leaderboard` and `GET /api/profile` have existed since Phase 3
with zero UI. Added `LeaderboardScreen.tsx` (tabs: global rankings with a
scope selector + "pure only" toggle, and a "My Stats" tab reading
`/api/profile`), plus a live "Best" figure next to the score during play
(`gameStore.loadProfile()`, refreshed after boot and after every verified
`run/finish`) so there's something to chase mid-run, not just at game over.
While wiring "My Stats" up, found `profile.ts`'s `streak` field was still
hardcoded to `0` with a stale "not wired up yet" comment from Phase 3 — the
economy work in Phase 5 (`dailyStats`, `grantDailyGiftIfNeeded`) already
tracks a real per-day streak that `/api/profile` just wasn't reading. Fixed
to read today's `dailyStats` row, with a new `profile.test.ts` (previously
this route had zero test coverage) covering the zeroed/no-history case, the
real streak value, and stats picking up a verified run.

## Progress lost on close: periodic checkpointing left a real gap for a naive close

The existing every-25-actions checkpoint is fine for the steady state, but
a player closing Telegram mid-session lands in the gap between checkpoints
far more easily than the "every 25 actions" cadence suggests — the user's
report ("progress is lost when I close the app") was a real gap, not a
misunderstanding of the existing checkpointing. Added a `visibilitychange`
(`document.hidden`) / `pagehide` listener, registered once at module load
(a single global browser-lifecycle concern, not tied to any component's
mount), that force-checkpoints immediately regardless of the 25-action
threshold. The request uses `fetch(..., { keepalive: true })` rather than
`navigator.sendBeacon` — `sendBeacon` can't attach the `Authorization`
header the run-token auth requires, while `fetch`'s `keepalive` flag gets
the same "survive page teardown" guarantee while keeping normal headers, so
no server-side change was needed. Verified end-to-end (not just "the
listener fired"): placed one piece (under the periodic threshold), forced
`document.hidden = true` + dispatched `visibilitychange` from Playwright,
and confirmed both the checkpoint request's 200 response and — checked
directly against Postgres — that the run row's `actions` array in the
database actually contains that one placement.

## Added a main menu — bootstrap no longer auto-starts or auto-resumes into a run

Previously `bootstrap()` either resumed an in-progress run or minted a
brand new one automatically, landing the player straight on the board every
time. The user asked for an explicit menu they land on instead, from which
they choose to continue or start fresh, check the leaderboard/their own
stats, or check their power-up counts and buy more — all of which already
existed as components (`LeaderboardScreen`, `ShopOverlay`) or data
(`inventory`) with no single home screen tying them together. Added a
`screen: "menu" | "game"` field to the store; `bootstrap()` still loads a
resumable run into the store (so "Continue" has something to resume) but
never flips `screen` to `"game"` itself — that's now only ever a deliberate
`continueRun()`/`newRun()` call from `MainMenu`, or the in-game "🏠" button
back the other way. A run that's merely *loaded* (not yet entered) doesn't
enable Telegram's closing confirmation either — that only turns on once the
player actually enters a run, matching "nothing to lose yet" while sitting
on the menu. `MainMenu` also surfaces the same power-up counts as the
in-game inventory bar (read-only) so "how many upgrades do I have" doesn't
require actually starting a run to check.

## Verified end to end: fresh menu → play → checkpoint → return → continue

Scripted through headless Chromium: a brand-new session lands on the menu
showing "Play" (no resumable run) with real inventory counts and working
Leaderboard/Shop buttons; tapping Play enters the game with a genuinely
fresh `runId`; placing pieces updates the score; tapping "🏠" returns to the
menu, which now shows "Continue" (plus a "start a new game instead"
fallback) instead of "Play"; tapping Continue re-enters the *same* run with
the *same* score, entirely from client-side state with no network round
trip. 113 engine tests (111 + 2 new) and 51 API tests (48 + 3 new, covering
the profile streak fix) all pass; both `tsc --noEmit` and `vite build`
stay clean across every workspace package.

# Phase 6: polish (§12's deferred checklist — theme params, haptics, CloudStorage, share cards)

`telegram/webapp.ts` named these four items as explicitly deferred back in
Phase 2. All four are wired now; none needed a server-side change — they're
all client-side Telegram WebApp SDK surface.

## Theme params override a deliberately small subset of CSS variables, as inline styles

Real `WebApp.themeParams` + `colorScheme` now drive `--nonet-bg`,
`--nonet-board`, `--nonet-cell-empty`, `--nonet-text`, `--nonet-text-dim`,
`--nonet-accent` (from `button_color`), and `--nonet-danger` — set as
inline styles on `<html>` via `applyThemeParams()`, re-run on Telegram's
`themeChanged` event. Deliberately *not* touched: the five `--nonet-piece-*`
colours, radius, and shadow — those are the game's own visual identity
(§15), not something that should shift with the user's Telegram theme the
way chrome/background colours reasonably should. Inline styles on `<html>`
always beat `theme.css`'s `:root { ... }` rule for the same element
regardless of specificity, so this layers cleanly over — rather than
replaces — the existing `prefers-color-scheme` fallback that plain-browser
dev/testing still relies on (no real `Telegram.WebApp` object there, so
`applyThemeParams` no-ops and the CSS fallback alone applies).

## Haptics are scaled to what actually happened, not a single generic buzz

`hapticImpact("light")` for a plain placement, `hapticImpact("medium")` for
any clear, `hapticNotification("success")` for a perfect clear,
`hapticNotification("error")` for both an illegal drop and reaching game
over, `hapticNotification("success")` for a completed revive purchase, and
`hapticSelection()` for menu/tab navigation. All gated behind a single
`hapticsEnabled` module flag (default on) so every call site stays a
one-liner regardless of the user's preference — see below.

## Haptics preference is real user-facing state, backed by CloudStorage, not a platform on/off switch

Telegram's own haptics either exist on a client or they don't — nothing to
toggle there. The toggle is ours: a `hapticsEnabled` preference synced via
`WebApp.CloudStorage` (a small per-user key-value store that follows the
user across their devices), with a `localStorage` fallback outside
Telegram so the toggle still persists locally during dev/testing rather
than silently doing nothing. Loaded once, fire-and-forget, during
`bootstrapTelegramWebApp()` — by the time the main menu can actually render
(after the session/profile round trip completes), the single CloudStorage
read has essentially always already resolved, so no loading state was
built for it.

## Share cards use `t.me/share/url`, not inline-mode

Telegram Mini Apps have a few ways to let a player share something: bot
inline-mode query results, `shareToStory`, or a plain
`t.me/share/url?url=...&text=...` deep link opened via
`WebApp.openTelegramLink`. The first needs bot-side inline-mode
configuration in BotFather; the Mini App has no server-rendered "story"
asset to share. `t.me/share/url` needs neither — it opens Telegram's native
"choose a chat" sheet with pre-filled text, working with any bot as-is.
Shared text links back to the Mini App's own `window.location.origin`
rather than a hardcoded bot deep link — no `BOT_USERNAME` config was added
for this, since the app's own origin is already exactly the right thing to
share and requires zero extra plumbing. Available from both the game-over
screen (share the run's score) and the "My Stats" tab (share the
all-time best).

## Verified without a real Telegram client, by mocking the WebApp SDK

None of this is testable through `ALLOW_DEV_SESSION`'s plain-browser dev
path the way earlier phases' manual passes were — there's no real
`window.Telegram.WebApp` there at all. Instead, drove headless Chromium
with a `page.addInitScript`-injected mock `Telegram.WebApp` (themeParams,
`HapticFeedback`, `CloudStorage`, `openTelegramLink`, all instrumented to
record calls) and confirmed, end to end rather than by reading the code:
the mocked theme's colours actually land on `<html>`'s inline style and
visibly repaint the whole UI; a real placement fires exactly one
`impactOccurred("light")` call; toggling haptics off in the menu writes
`"false"` to the mocked CloudStorage *and* silences every subsequent
haptic call (not just cosmetically unchecking a box); and the share button
calls `openTelegramLink` with a correctly-encoded
`t.me/share/url?...&text=I%20scored%204%2C242%20in%20NONET!...` string.
113 engine tests, 51 API tests, `tsc --noEmit`, and `vite build` all still
pass/succeed after these changes.

# Pre-Phase-7 addendum: fullscreen, safe areas, and a landscape layout

Requested before moving on to §19 step 7 (Gram/TON stubs): launch straight
into fullscreen, respect Telegram's `safeAreaInset`/`contentSafeAreaInset`,
and add a landscape layout (board centered, score+hints on the left,
controls+hand tray on the right).

## Could not verify Telegram's own docs live — implemented from trained knowledge, defensively

Both linked doc pages (`core.telegram.org/bots/webapps#...`) 403'd through
this sandbox's egress proxy — confirmed via the proxy's own status endpoint
as a policy denial on `core.telegram.org`, not a transient failure, so no
retry or workaround was attempted (per the proxy's own guidance). Every new
field/method (`isFullscreen`, `requestFullscreen`, `exitFullscreen`,
`safeAreaInset`, `contentSafeAreaInset`, the `safeAreaChanged` /
`contentSafeAreaChanged` / `fullscreenChanged` / `fullscreenFailed` events)
is written from Bot API 8.0 knowledge, but feature-detected the same way
every other WebApp API surface in this file already is (`webApp.method?.()`,
`webApp.field ?? fallback`) — a wrong field name or an older client without
this API resolves to the same safe fallback (0 insets, no fullscreen
request attempted) rather than throwing. Flagged to the user directly
rather than silently presenting it as doc-verified.

## `safeAreaInset` and `contentSafeAreaInset` are summed, not maxed, per edge

They're two independently-obstructing things stacked on the same edge, not
two measurements of the same one: `safeAreaInset` is the OS-level
obstruction (notch, home indicator) that only really matters once running
fullscreen; `contentSafeAreaInset` is Telegram's *own* chrome (header bar,
back/close/settings controls) drawn on top of that. Content needs to clear
both, so each edge's usable inset is `safeAreaInset[edge] +
contentSafeAreaInset[edge]`, exposed as one combined `--tg-inset-*` custom
property per edge. Where this combined value meets the browser's own
`env(safe-area-inset-*)` (which already covers the non-Telegram/plain-notch
case), the two *are* maxed against each other (`--nonet-safe-*`) — those
are alternate sources for the same single obstruction, not two stacked
ones.

## Centralized into four `--nonet-safe-*` vars, replacing four components' local `env()` calls

`ScoreHud`, `LeaderboardScreen`, `ShopOverlay`, and `HandTray` each computed
their own `calc(10px + env(safe-area-inset-top, 0px))` independently. Since
"content must stay inside `contentSafeAreaInset`" is now a real constraint
(not just a nice-to-have `env()` fallback for a phone notch), centralizing
the combined value in `theme.css` means every consumer gets Telegram's own
insets too without each one needing to know `--tg-inset-*` exists.

## Landscape: `display: contents` splits one row into two independent grid items, without duplicating either

The hardest part of "board centered, score+hints left, controls+tray
right" is that `hudRow` (score + the Home/Shop buttons) is one visual row
in portrait but needs its two halves on *opposite sides* of the screen in
landscape — genuinely different relationships, not just repositioned as a
unit. Rather than render two separate JSX trees (which would double-mount
`Board`/`HandTray`/etc., breaking their single `boardRef` and drag-session
state), `.hudRow` becomes `display: contents` under `@media (orientation:
landscape)`: it stops generating its own box, so its two children (a
`scoreArea` div and a `controlsArea` div) become direct grid items of
`.app`'s grid instead of flex children of `hudRow` — placeable via
`grid-area` on opposite sides of a 3-column `grid-template-areas` layout
(`score board controls` / `hint board inventory` / `hint board tray`,
`board` spanning all 3 rows so it centers vertically across the full
height) without a single component being mounted twice. Portrait keeps
`hudRow`'s original `display: flex` — same DOM, same components, just a
different CSS relationship between the exact same nodes.

## HandTray's jump-prevention fix (see the earlier "board jumped" entry) needed a second axis

That fix reserved tray *height* so a row of pieces couldn't reflow the
board vertically. Landscape's right column stacks the 3 pieces
*vertically* instead (a horizontal row of up to 5-cell-wide pieces doesn't
fit a ~150px-wide column) — which flips which axis varies per hand: now
it's *width*, not height, that needs reserving to avoid the same class of
jump recurring sideways. Rather than duplicate the "reserve the tallest
possible piece" computation, the already-computed pixel value is exposed
as one CSS custom property (`--nonet-tray-reserve`) alongside the existing
`minHeight`, and `HandTray.module.css`'s landscape rule reads it as
`min-width` — one JS computation, one CSS variable, consumed as whichever
dimension actually matters per orientation.

## Verified geometrically, not just visually, against a mocked WebApp SDK

Headless Chromium at a landscape (780x400) viewport with a mocked
`Telegram.WebApp` confirmed: `requestFullscreen` is actually called;
`--tg-inset-top` computes to exactly `safeAreaInset.top +
contentSafeAreaInset.top`; and — read directly via
`getBoundingClientRect()`, not eyeballed from a screenshot — the board is
genuinely horizontally centered in the viewport, score sits at the
top-left, controls at the top-right (same row as score), and
inventory/tray stack below controls on the right, exactly matching the
requested layout. Re-ran the existing 30-real-placement board-stability
check (from the earlier "board jumped" fix) in landscape specifically and
confirmed the board's position and size still never moves by a pixel
across many hand changes; a separate portrait-viewport screenshot confirms
no visual regression there. 113 engine tests, 51 API tests, `tsc --noEmit`,
and `vite build` all still pass/succeed.

# Two more user-reported bugs

## The "region too large" hint could still push the board down

The earlier hand-tray jump fix reserved a `min-height` for `.hint`, but
`min-height` is only a floor — the actual message ("Region too large (N
cells) — pick a smaller pocket") wraps to 2 lines on a narrower viewport,
and a 2-line box is taller than a 1-line `min-height`, pushing everything
below it (the board) down exactly like the original bug. Fixed by using a
fixed `height` (not `min-height`) with `overflow: hidden` instead — a box
that can't grow past its set height can't push anything, regardless of how
many lines the text wraps to.

## Releasing a drag outside the board could still place it there

Both `useDragPlacement` (piece placement) and `usePowerupTargeting`
(pencil/eraser/bomb/fill) compute a target row/col by `clamp`ing the
pointer's fractional board position into `[0, BOARD_SIZE)` — correct for
keeping a piece whose center is near an edge fully on-grid, but it clamped
*any* pointer position this way, including one that had left the board
rect entirely (e.g. still hovering the hand tray or the score/inventory
area above it). That meant releasing off the board could still snap to
and place on some in-bounds cell nowhere near the pointer, and the ghost
preview would render there too — clearly wrong once you notice the pointer
was never actually over the board. Fixed the same way in both hooks: bail
out to `null` (no ghost/preview, no placement/commit) the moment the raw
pointer coordinates fall outside the board element's own
`getBoundingClientRect()`, before any clamping happens.

Verified both directly, not just by re-reading the fix: for the hint, the
board's `getBoundingClientRect()` was read before and during a real
region-too-large hint and confirmed byte-identical; for the drag fix,
dragging a piece onto the board (confirmed via `[data-ghost]` cells
actually present) and then off it again confirmed the ghost cells vanish
entirely, and releasing there confirmed the hand and board state are
completely unchanged (no phantom placement).

# Phase 7 — §14 Gram/TON stub

## "Gram" is a June 2026 rebrand of the token, not a new/different chain

Asked for clarification before building this, since the original brief's
§14 text wasn't available verbatim after compaction and "Gram" is
ambiguous (a new internal soft currency? a typo for "Stars"? a TON
synonym?). The user's answer — "TON is called Gram again now, check the
latest updates" — was a factual claim about the world, not a design
preference, so it got verified rather than taken on faith: multiple
independent sources (AMBCrypto, MEXC, crypto.news, Wikipedia, Yahoo
Finance) confirm that on June 15 2026, following an 81.22% community vote,
The Open Network's native token was renamed from Toncoin (TON) back to
Gram (GRAM) — a pure ticker/branding change. No token swap; holder
addresses and balances are unchanged. Critically, the network/protocol
itself keeps the name "The Open Network (TON)" — only the coin's
user-facing name changed. That's why every place in this codebase that
talks to the *protocol* still says "TON Connect" (that's the library's
real, unchanged name), while every place that talks to the *currency* in
user-facing copy says "Gram" (e.g. the connect button: "Connect wallet for
future Gram rewards").

## Real TON Connect, not a text field — but address-capture only

The user explicitly asked for "real TON Connect (recommended)" over a fake
text-input stub. `@tonconnect/ui` is wired as the actual protocol: a
same-origin `GET /api/tonconnect-manifest.json` (served dynamically from
`WEBAPP_URL`, since a single Docker image doesn't know its own deployed
origin at build time) feeds `TonConnectUI`, which mounts the genuine
QR-code/wallet-list modal and drives the real TON Connect bridge protocol.

What this stub deliberately does **not** do, and why that's still an
honest reading of "stub":
- **No `ton_proof` verification server-side.** `POST /api/profile/wallet`
  persists whatever address the client reports, unverified. Since no
  funds or payouts flow through this address yet (see next point), a
  spoofed address can't be used to steal anything — it would just make a
  future payout (once one exists) go to the wrong place, which is exactly
  the kind of check that needs adding *before* payouts exist, not before
  this stub does.
- **No transactions, no payouts.** This phase only captures and stores an
  address for future Gram reward payouts described in the brief — it does
  not send Gram, mint anything, or touch a real ledger.
- **UI state reflects the live TonConnectUI session, not the server's
  stored address.** `MainMenu` shows "connected" based on
  `currentWalletAddress()` (TonConnectUI's own restored session), not
  `profile.tonAddress`. This is intentional, not an oversight: wallet
  *control* lives with whatever device actually paired via TON Connect, so
  showing the server's copy as "connected" on a different device would
  claim a control the device doesn't have. The server's copy exists purely
  so a payout system (when built) has somewhere to look up an address —
  it's not meant to drive this button's state.
- **Placeholder icon.** `apps/web/public/icon-192.png` is a flat
  `--nonet-accent`-colored square generated for this stub (no real brand
  artwork exists yet) — the manifest needs *some* fetchable icon URL, and
  a solid color is honest about being a placeholder rather than a design
  attempt. Replace before shipping any real branding push.

## Verified what's actually testable without a real TON wallet

Same constraint as Stars in Phase 5 (no live Telegram client), except here
there's also no real TON wallet or mobile bridge in this sandbox, so a
full connect→sign→confirm round trip can't be exercised end-to-end. What
*was* verified, via headless Chromium against the running dev servers
(mocked `Telegram.WebApp`, real Postgres, real API):
- The "Connect wallet" button renders on the main menu with Gram-framed
  copy (not "TON"/"Toncoin" as a currency name).
- Clicking it mounts the *real* `TonConnectUI` modal (not a placeholder) —
  confirmed by screenshot: a genuine QR code with the app's own manifest
  name/icon watermarked into it, plus the standard wallet list (Wallet in
  Telegram, Tonkeeper, MyTonWallet, "View all wallets") and "TON Connect"
  footer branding. The wallets-list registry fetch itself fails in this
  sandbox (outbound network policy blocks it, same class of restriction
  hit earlier with `core.telegram.org`) but TonConnectUI degrades
  gracefully and still renders its bundled wallet shortlist — proving the
  manifest wiring and library integration are both genuinely live, not
  mocked.
- Backend persistence has full integration-test coverage (`POST
  /api/profile/wallet`, `apps/api/test/profile.test.ts`): rejects without
  a session token, rejects a malformed address, links and persists across
  a subsequent `GET /api/profile`, and unlinks via `tonAddress: null`.

Not verified, and not verifiable here: an actual wallet completing the
pairing handshake, a real `ton_proof`, or any payout — all require a real
TON wallet/mobile client this environment doesn't have.

113 engine tests, 56 API tests, `tsc --noEmit`, and `vite build` all
pass/succeed.

# §19 — native navigation, header theming, and settings/themes

## Leaderboard/Shop/Settings became full screens, not popups over the menu

Previously `MainMenu` owned `shopOpen`/`leaderboardOpen` local state and
rendered `ShopOverlay`/`LeaderboardScreen` as an absolutely-positioned
overlay *on top of* the still-mounted menu. The user asked for real
navigation instead: Leaderboard/Shop are now driven by the store's own
`screen` field (extended from `"menu" | "game"` to `"menu" | "game" |
"leaderboard" | "shop" | "settings"`), and `App.tsx` switches which single
screen is mounted — the menu is genuinely unmounted while any of the
others is showing, not hidden underneath. Since every non-menu screen is
reached only from the menu (never from each other), "back" from any of
them always means "menu" — a flat one-level graph, not a generic
stack/router; `goToMenu()` is the single, uniform back-handler for all of
them. The in-game Shop button (opened *during* a run, to top up power-ups
without losing your board) deliberately stays a real overlay — leaving the
game screen to view it as a full page would mean losing sight of the live
board mid-run, which the user's request didn't ask for and would be a
regression, not an improvement.

## Native BackButton/SettingsButton drive the same navigation the in-app controls do

Added `showBackButton`/`hideBackButton`/`initSettingsButton` to
`webapp.ts`, feature-detected the same way as every other Bot-API-version
addition in this file. A single `useEffect` in `App.tsx`, keyed on
`screen`, shows the native BackButton (wired to `goToMenu`) on every
screen but the menu and hides it there — one place decides this for all
five screens, rather than each screen managing its own BackButton
visibility. SettingsButton is registered once at boot with a single fixed
handler (`goToSettings`) since it's a persistent native menu control, not
a per-screen affordance, matching how Telegram itself presents it.

## Leaving the game screen via Back saves progress immediately, not just on the next periodic checkpoint

`goToMenu()` already existed as the in-game Home button's handler; it now
also force-checkpoints (ignoring the usual 25-action threshold) whenever
the screen being left is `"game"` — covering both the native BackButton
and the in-app Home button, since both route through the same store
action. This is on top of, not instead of, the existing
visibilitychange/pagehide safety net from the earlier "progress lost on
close" fix — that net still catches a real app close regardless of
whether this specific checkpoint request succeeds, so the new call is
fire-and-forget rather than blocking navigation on a round trip.

## `header_bg_color`/`setHeaderColor` use Telegram's color-*key* mode, not a static hex, in auto mode

`setHeaderColor('bg_color')` (and the equivalent `setBackgroundColor`)
tells Telegram to keep the native header/background permanently pinned to
whatever `bg_color` currently is — including through a live `themeChanged`
event — rather than a one-time hex snapshot that would need re-sending on
every theme change. Called from inside `applyThemeParams` itself (the
same function that already runs at first paint and on every
`themeChanged`), so there's no separate code path to keep in sync, and
critically no window where the native header briefly shows the wrong
color before the page's own background catches up — the two are set from
the same function, in the same tick, using the same source value. This
mode is only correct while "auto" (Telegram-tracking) is the active theme
— see below for what happens once a user picks an explicit theme instead.

## Explicit theme choice (Auto/Light/Dark/premium) vs. Telegram's own live theme

The brief asks for both: Telegram's live theme should keep working as
before (`themeParams`, `themeChanged`), *and* a user should be able to
override it in Settings with Light/Dark or (once purchased) a premium
palette. These are two different authorities over the same CSS custom
properties, so they need an explicit precedence rule, not just "last
writer wins by accident": `applyThemeParams` (Telegram's own sync) now
bails out immediately if an explicit theme mode is active, checked via a
single module-level `themeMode` flag in `webapp.ts`. Switching back to
"auto" clears the explicit override and immediately re-invokes
`applyThemeParams` once, rather than waiting for the next `themeChanged`
event, so the OS/Telegram-driven theme reappears the instant the user
picks "Auto" again, not on some future event.

Explicit palettes (`light`, `dark`, and every id in `@nonet/shared`'s
`PREMIUM_THEMES`) are applied via the exact same mechanism Telegram's own
sync already uses — `documentElement.style.setProperty(...)` — since
inline styles unconditionally beat any stylesheet rule (the existing
`:root`/`prefers-color-scheme` blocks in `theme.css`), this needed no new
CSS at all; explicit mode just writes to the same custom properties from
a different source. The preference is persisted via CloudStorage (the
same key-value bridge haptics already uses), and — because `bootstrap()`
now `await`s `loadThemePreference()` *before* `syncTelegramTheme()` runs —
a returning user's explicit choice is in effect before Telegram's own
live sync could ever paint the wrong colors first, avoiding exactly the
"flash of the wrong theme at startup" the user called out as important.
`loadHapticsPreference()` was moved to run unconditionally too (previously
gated behind an `if (!webApp) return`, meaning it silently never ran
outside a real Telegram WebView) — that gate no longer makes sense once a
sibling preference (theme) needs to work in plain-browser dev/testing too,
and CloudStorage's localStorage fallback already existed specifically for
this case.

## Premium themes reuse the existing generic inventory/shop pipeline — no schema changes

`inventoryBalance` was already a generic `(userId, item) -> qty` table with
no enum constraint on `item` (confirmed: `inventory` in the shared schemas
is `z.record(z.string(), z.number())`, not restricted to `PowerupKind`).
So a purchasable theme is just another SKU whose `contents` grants one
unit of `theme_<id>` — the exact same purchase → Stars webhook → inventory
credit path that already exists for pencils/erasers/etc., with zero new
tables, columns, or endpoints. `packages/shared/src/themes.ts` is the
single source of truth for the theme catalogue (id, title, description,
price, palette) — `apps/api`'s `seedShopSkus` derives the SKU rows from it
and `apps/web`'s Settings screen derives the picker (and the actual CSS
custom property values) from the same list, so the two can't drift apart.
Ownership is just `inventory[themeInventoryKey(id)] > 0`; an unowned theme
in Settings is shown locked (with a lock icon) and tapping it navigates to
the Shop instead of applying anything.

Three premium palettes were invented for this phase (Sunset, Ocean, Neon —
see `packages/shared/src/themes.ts` for exact hex values) since the brief
asked for "purchasable themes exist" without specifying which — this is a
content/design choice, not a technical constraint, and can be edited or
extended purely by editing that one file (plus reseeding).

## shadcn/ui: blocked, by design choice deferred to the user

The literal requested command — `npx shadcn@latest init --preset
b4zjJzewi --template vite` — cannot run in this sandbox: `ui.shadcn.com`
(the CLI's registry, used by *every* subcommand including plain `add
button`, not just a preset-specific call) is rejected at the network
proxy with the same class of policy denial hit earlier for
`core.telegram.org` — confirmed by actually running both `init` and `add
button` and observing identical `CONNECT ... 403` failures, not just a
`curl` probe. Given the scale of a real shadcn/Tailwind migration (every
screen's markup and styling) and that shadcn's registry-fetched components
can't be reliably hand-reproduced for an unfamiliar newer style variant
(the failed request's query params showed `style=nova, theme=sky` — not
the classic `default`/`new-york` styles this assistant has reliable
trained knowledge of), the user was asked how to proceed and chose to run
the CLI locally and push the result rather than have it hand-approximated.
Everything in this phase was therefore built on the existing CSS-module
system so it's fully functional today; migrating the resulting JSX onto
the pushed shadcn scaffold is expected to be a visual re-skin once it
arrives, not a re-derivation of any navigation/theme/checkpoint logic.

## Verified with headless Chromium against real dev servers (mocked Telegram WebApp, real Postgres, real API)

21 checks covering: `setHeaderColor`/`setBackgroundColor` called with
`'bg_color'` at first paint; the main menu's exact 5-item order with
"Continue" disabled when there's no resumable run; the native BackButton
mock hidden on the menu and shown (with a working handler) on
Leaderboard/Shop; a simulated *native* BackButton press (not the in-page
arrow) correctly returning to the menu from each; a simulated
SettingsButton press jumping straight to Settings; selecting Light/Dark
applying that exact palette's `--nonet-bg` immediately and repointing the
native header to that literal hex; clicking a locked premium theme
redirecting to the Shop without changing the active palette; selecting
"Auto" reverting to the pre-override background; and — starting a real
run, placing a real piece via simulated pointer drag, then firing the
mocked native BackButton — an actual `POST /api/run/checkpoint` request
firing before returning to the menu. All 21 passed. 113 engine tests, 57
API tests (one new: crediting a purchased theme SKU as a permanent
inventory unlock), `tsc --noEmit` across every package, and `vite build`
all pass/succeed.

# §19 continued — shadcn primitives, i18n, and a dozen UX fixes

## The user ran `shadcn init` locally; `shadcn add` is still blocked here

The user ran the requested `npx shadcn@latest init --preset b4zjJzewi
--template vite` on their own machine (where `ui.shadcn.com` isn't
blocked) and pushed the result: `components.json` (style `base-nova`,
base color zinc), Tailwind v4 via `@tailwindcss/vite`, `src/index.css`
with the full oklch design-token set, `src/lib/utils.ts`'s `cn()` helper,
and `@base-ui/react` (Base UI — the same team's successor to Radix;
this preset uses it instead of `@radix-ui/*`) as a dependency. That got
the *scaffold* in place, but `shadcn add <component>` (Button, Dialog,
Switch, Checkbox, ...) still needs the same blocked registry host —
confirmed by re-running it in this sandbox, same `CONNECT ... 403` as
`init` hit before the user's local run. So every primitive under
`src/components/ui/` (`button`, `card`, `switch`, `checkbox`, `dialog`,
`label`, `badge`, `separator`, `input`, `tabs`) was hand-authored here
against the *real* pushed tokens and the real `@base-ui/react` API
(`Switch.Root`/`Thumb`, `Checkbox.Root`/`Indicator`, `Dialog.Root`/
`Trigger`/`Portal`/`Backdrop`/`Popup`/`Title`/`Close`, `Tabs.Root`/`List`/
`Tab`/`Panel`) — not registry-fetched, but no longer guessed at unfamiliar
tokens either, unlike the earlier TON Connect-era blocker. Swapping any of
these for the real `shadcn add` output later is a compatible drop-in
(same prop shapes, same Tailwind class conventions) whenever the user
wants exact registry parity.

## A hidden portal z-index bug the primitives themselves exposed

Every full-page screen (Shop/Leaderboard/Settings) sits at `z-[600]`
(GameOverOverlay at `z-[500]`) so it renders above the menu underneath.
Base UI's `Dialog.Portal` renders to `document.body` — a *sibling* of
those `z-[600]` elements, not a descendant — so the dialog's own z-index
has to out-rank them numerically; nesting later in the DOM doesn't help
once portaled. The hand-authored `Dialog` initially used Tailwind's
stock `z-50`, which is *lower* than `z-[600]`: opening the Shop's theme
preview dialog rendered it, visually, on top — but the Shop's own
list items underneath still intercepted every pointer event, since they
were higher in the actual stacking order. Playwright caught this
directly (a click meant for the dialog's "Light" toggle kept resolving
to the row underneath instead) rather than it only surfacing as a subtle
visual/interaction bug in real testing. Fixed by moving the Dialog's
backdrop and popup to `z-[700]`, comfortably above every screen that
might open one.

## i18n: `en`/`ru`, Telegram `language_code` auto-detect, override persisted like haptics/theme

Added `i18next`/`react-i18next`. `en.ts`/`ru.ts` are plain (non-`as const`)
objects — `ru`'s type is `typeof en`, which enforces identical *keys*
across locales (TypeScript widens `as const`-free string literals to
`string`) so a missing translation is a compile error, not a silent
English fallback in production. "Auto" (default) resolves from Telegram's
`initDataUnsafe.user.language_code`; an explicit choice in Settings
overrides it, persisted via CloudStorage exactly like the existing
haptics/theme preferences (`webapp.ts` gained a parallel `languageMode`
section). `loadLanguagePreference()`/`loadHapticsPreference()` now both
run *unconditionally* in `bootstrapTelegramWebApp()` rather than being
skipped when there's no real Telegram WebView — the old haptics-only gate
predated CloudStorage's own localStorage fallback and no longer made
sense once a second preference needed the same plain-browser behavior.
Every user-facing string in the app (including aria-labels, the boot
screen, and the floating combo/perfect-clear popup) now routes through
`t()` — verified with an actual runtime language switch in Playwright
(Settings → Русский → main menu re-renders as Продолжить/Новая игра/...
live, no reload).

## Twelve specific UX fixes from user feedback + screenshots

- **Home/Shop buttons overlapping Telegram's fullscreen controls**: root
  cause was `.controlsArea` (App.module.css) having no top padding of its
  own, relying on `align-items: center` to vertically center it against
  `.scoreArea`'s *padded* height — centering a shorter unpadded sibling
  inside a taller padded one doesn't guarantee it clears the same safe
  boundary; it can center right into the region Telegram's own chevron/
  menu controls occupy in fullscreen. Fixed by giving `.controlsArea` the
  exact same top padding as ScoreHud's own `.hud` rule and switching
  `.hudRow` to `align-items: flex-start` — both halves now start at the
  same Y, not just get centered against each other.
- **In-game Shop button's text label**: removed — icon-only now, matching
  the request that the icon already says enough. Kept `aria-label="Shop"`
  for accessibility (confirmed via Playwright: empty text content, a real
  `aria-label` attribute).
- **Piece grab hit-area inconsistent per shape**: a 1-cell piece's
  clickable region used to be exactly its own tiny rendered box (plus a
  44px floor); a 5-cell piece's was proportionally huge. Rather than
  resizing `.slot` itself to the max-piece-footprint (which would blow
  out the tray's flex width — three 5x5-sized slots side by side don't
  fit a narrow phone), added a separate absolutely-centered `.hitArea`
  overlay per piece, fixed to the same `trayReserve` (5x5-cell-equivalent,
  already computed for the tray's own jump-prevention) size regardless of
  the piece's actual shape. The *visible* piece is unchanged — a 1x1 still
  looks small — only the invisible touch target is now uniform. Verified:
  all three hand slots report the identical hit-area width regardless of
  which piece occupies them.
- **Power-ups repositioned**: landscape moves the whole `InventoryBar`
  into the left grid column (under score, was previously on the right
  with controls/tray) with `hint` swapping to the right in its place;
  `InventoryBar` itself uses Tailwind's built-in `landscape:`/`portrait:`
  variants to flip from a horizontal row (count *below* each icon,
  non-overlapping — the old design overlaid the count as a badge on the
  icon's corner) to a vertical column (count to the *right* of each icon,
  since a 3-4 digit count wouldn't fit under a narrow column icon).
- **Counts ≥1000 abbreviate** as "1k"/"1.2k" (or "1к"/"1.2к" in Russian) —
  `formatCount()`, with the suffix itself translated (`common.thousandsSuffix`)
  rather than hardcoded, so it's correct in either language.
- **Monochrome theme** added to `packages/shared`'s `PREMIUM_THEMES` (a
  grayscale-only palette, no hue at all) — seeds automatically via the
  same generic shop pipeline as Sunset/Ocean/Neon, no new code path.
- **Haptics toggle → shadcn `Switch`**; **Leaderboard's "Pure only" →
  shadcn `Checkbox`** — both hand-authored against `@base-ui/react`'s
  `Switch.Root`/`Thumb` and `Checkbox.Root`/`Indicator`, no native
  `<input type="checkbox">` left visible anywhere in the app.
- **Button text color**: the `Button` component's default variant reads
  `bg-primary text-primary-foreground` from the pushed tokens — verified
  `--primary-foreground` really does resolve near-white (oklch L=0.977),
  not the old hardcoded `#0b0e13` (near-black) still sitting in two
  now-deleted CSS modules (`ShopOverlay.module.css`'s buy button,
  `App.module.css`'s now-superseded `.bootRetry`).
- **Star icon colors**: every Stars-price icon now explicitly
  `fill="#FFC335" stroke="#E98615"` (a small `StarIcon` wrapper in
  ShopOverlay, reused inline in GameOverOverlay's revive button) rather
  than inheriting `currentColor`.
- **Theme preview dialog**: clicking a theme *item* in the Shop (not just
  its buy button) opens a dialog with a Light/Dark toggle and a static
  mock board+HUD painted in that theme's actual palette values before any
  purchase. Since every premium theme is authored as a single (dark-
  leaning) palette, not a light/dark pair, the "Light" preview is
  *derived* on the fly (`derivePreviewPalette`: background/board/empty-
  cell lightened toward white, text darkened toward black) rather than
  requiring every theme to be double-authored — an approximation for
  preview purposes only; the theme itself always applies exactly as
  authored regardless of the app's own light/dark mode.

## Verified with headless Chromium against real dev servers (Postgres, API, mocked Telegram WebApp)

17 checks: main-menu list order/labels; Settings shows Monochrome +
locked-icon premium themes; haptics uses a real `[role=switch]`, zero
native checkboxes remain; switching language to Russian re-renders the
*entire* main menu live; primary button text resolves to a light color,
not black; Star icons carry the exact `#FFC335`/`#E98615` fill/stroke;
clicking a Shop theme item opens the preview dialog (light/dark toggle +
25-cell mock board present) — this is what caught the z-index bug above;
all three hand-tray pieces report an identical hit-area width regardless
of shape; the in-game Home button's top position matches the Score
label's within 30px (not floating above it into the unsafe zone); the
in-game Shop button has empty text content with a real `aria-label`.
113 engine tests, 58 API tests (one new: the Monochrome theme SKU seeds
and is listed), `tsc --noEmit` across every package, and `vite build`
all pass/succeed.

# §19 continued — a real theming bug, not a cosmetic one

## `theme.css`'s unlayered `button { color: inherit; }` silently beat every Button's text color, everywhere

The user reported light theme buttons showing dark text on a dark
background — investigating (with no image actually attached to inspect,
only the description) turned up something bigger than a single button:
`theme.css` predates the shadcn migration and sets its element resets
(`*`, `body`, `button`, `:focus-visible`, ...) as plain, unlayered CSS.
Tailwind's own utilities (from `index.css`'s `@import "tailwindcss"`) are
generated *inside* named CSS cascade layers. Per the cascade-layers spec,
**styles outside any layer always win over styles inside one, regardless
of specificity or source order** — so `button { color: inherit }`,
despite being a plain low-specificity element selector, was beating every
Button component's `text-primary-foreground` (or `text-white`) utility
class everywhere in the app, silently, this whole session. It didn't look
obviously broken before now only because dark theme's *inherited* body
text color (`--nonet-text`, near-white) happened to look plausible next
to a light-blue accent button — the exact same bug, just coincidentally
harmless-looking. Light theme's inherited text (`--nonet-text`, near-
black) against a blue button made it impossible to miss. Confirmed by
directly reading `getComputedStyle` on a live button: `--primary-
foreground` itself correctly resolved to the intended color the whole
time; the element's actual rendered `color` didn't match it at all,
confirming a cascade problem, not a token problem. Fixed by wrapping
`theme.css`'s element resets in `@layer base { ... }` — CSS layer names
are global across the whole document regardless of which file declares
them, so this merges into the *same* "base" layer Tailwind's own
`@import "tailwindcss"` already establishes, correctly losing to
Tailwind's "utilities" layer exactly as intended. This is also almost
certainly why last round's "Shop buy button text is white" Playwright
check passed for the wrong reason: it matched dark theme's inherited
near-white text color by coincidence, not the `text-white` class actually
taking effect — re-verified after this fix with an exact-value assertion
(`rgb(255, 255, 255)`, not a loose "is it light-ish" regex).

## Two disconnected theme systems, unified into one

Related but distinct: shadcn's own tokens (`--background`, `--primary`,
etc., in `index.css`) ship with a static light `:root` block and a
separate static `.dark` block, switched by a `.dark` class Tailwind's
`@custom-variant dark (&:is(.dark *))` expects on some ancestor —
nothing in this app ever added that class. So every Tailwind-styled
screen (Settings/Shop/Leaderboard/MainMenu/GameOver) was permanently
stuck on shadcn's *own* light palette, completely deaf to the app's real
`--nonet-*` theme system (Telegram sync, explicit Light/Dark, premium
palettes) that the board/HUD/tray still correctly follow via existing CSS
modules — this is what "dark theme now looks like this" was actually
showing: light-colored menu chrome next to a dark board. Fixed by
deleting shadcn's static `:root`/`.dark` blocks entirely and aliasing
every shadcn token to the matching `--nonet-*` custom property instead
(`--background: var(--nonet-bg)`, `--primary: var(--nonet-button-bg)`,
...). No `.dark` class needed anywhere now — both systems are one system,
and `webapp.ts`'s existing inline-style mechanism (which already beats
any stylesheet rule) drives all of it uniformly.

## A dedicated `--nonet-button-bg`, not a blanket color relayout

The request clarified two things that sound similar but aren't: (1) only
the Shop's *buy* buttons should get white text — nothing else should be
"customized" — and (2) light theme specifically needs its own button
background, since its accent (a fairly saturated blue) doesn't read well
under dark button text. So: `--nonet-button-fg` is one fixed dark color
(`#0b0e13`) across every theme, matching what "isn't customized"
everywhere except the Shop's buy buttons (which explicitly override to
white via `text-white`, exactly as asked). `--nonet-button-bg` defaults to
`var(--nonet-accent)` (works fine for dark/Sunset/Ocean/Neon/Monochrome —
their accents are all light/bright enough for dark text) but is
overridden to a dedicated Lime (`#84cc16`) specifically for the "Light"
theme, in both `theme.css`'s `prefers-color-scheme: light` fallback and
`webapp.ts`'s explicit `LIGHT_PALETTE` application — reverted the
blanket `text-white` I'd added to MainMenu's Continue, GameOverOverlay's
Play Again, and the boot screen's Retry button back to the Button
component's own (now correctly dark) default.

## Power-up buttons: count moved outside the square, not just repositioned within it

Last round's fix put the count below (portrait) / beside (landscape) the
icon, but still *inside* the same bordered button box, stretching it away
from square. Restructured `InventoryBar` so each power-up is a wrapper
`<div>` containing a plain square `<button>` (icon only, `aspect-square`,
fixed `h-11 w-11`) and a separate sibling `<span>` for the count outside
it — the wrapper itself flips `flex-col`/`flex-row` per orientation
(matching the same `landscape:` Tailwind variant used before), so the
button's own shape never changes.

## Monochrome missing from the Shop while present in Settings: a deployment-sync artifact, not a bug

Settings reads `PREMIUM_THEMES` directly from the `@nonet/shared` package
bundled into whatever web build is currently deployed — always in sync
with that build's code. The Shop's list comes from the live `shop_skus`
database table, populated by `seedShopSkus()` (an idempotent upsert) which
only runs when the **api** container actually restarts (`docker/
api.Dockerfile`'s `CMD` runs migrate-then-serve on every boot, guarded by
an advisory lock). If the web image was rebuilt/redeployed after
Monochrome was added but the api image wasn't restarted since, Settings
shows the new theme (compiled into the web bundle) while the Shop still
serves the old, unmigrated database rows — exactly the reported symptom.
Confirmed there's no code-level bug: `GET /api/shop`'s `active = true`
filter, the upsert's `onConflictDoUpdate`, and a fresh migration run
against the deployed database all check out — `curl`ing a freshly
migrated instance's `/api/shop` lists `theme_monochrome` correctly. No
code change; the fix is redeploying/restarting **both** the `web` and
`api` services together (`docker compose up -d --build`), not just one.

## Verified with headless Chromium (Postgres, API, mocked Telegram WebApp with realistic themeParams)

10 checks, this time with exact-value assertions rather than loose regex
after the earlier false-positive: body background matches Telegram's
real dark `bg_color` exactly (not shadcn's static light palette);
Settings screen background matches the app's dark bg exactly (same
value, same source — the two systems now agree); selecting Light sets
`--nonet-bg` to the light palette and `--nonet-button-bg` to the exact
Lime hex; the Continue button's actual computed background is that exact
Lime RGB and its text is exact dark RGB, not inherited near-black-passing-
as-white; a Shop buy button's text is exact white RGB; every power-up
button is a perfect square with zero text content, with the count
existing as a real sibling outside it. All 10 passed. 113 engine tests,
57 API tests, `tsc --noEmit` across every package, and `vite build` all
pass/succeed.

## Round 4: piece-grab overlap, jagged 3x3 dividers, achievements, "pure game," and re-diagnosing the Monochrome sync

### HandTray hit-areas: measured and clamped, not just uniformly enlarged

Last round's fix gave every dealt piece the same generous `trayReserve`
square hit-area (sized to the largest piece's 5x5 footprint) so a 1x1
piece was as easy to grab as a 5-cell one — but on a narrow phone,
`trayReserve` (up to ~150px) is far bigger than the actual gap between
tray slots (`clamp(8px, 4vw, 24px)`, capped at 24px), so adjacent
hit-areas overlapped and stole each other's taps — worse than before.
Fixed by *measuring* rather than assuming: `HandTray` now holds a ref per
slot, and a `useLayoutEffect` (so the corrected size lands before the
first paint — no flash of oversized, overlapping hit-areas) computes each
slot's real on-screen center via `getBoundingClientRect()`, takes the
distance to its immediate left/right (portrait) or up/down (landscape)
neighbor, and clamps that slot's hit-area to `min(trayReserve, that
distance)` — generous where there's room, never overlapping where there
isn't. Re-measured on a `ResizeObserver` over the slots (catches a piece
changing size) plus `resize`/`orientationchange` listeners (catches a
layout reflow the slots' own boxes don't change size for).

### 3x3 board dividers: `border` was silently resizing bordered cells

The divider lines were `border-right`/`border-bottom` applied directly to
`.cell`, conditionally per cell. With `box-sizing: border-box` in effect
globally (from the round-3 cascade-layers fix), a border on one side of a
cell shrinks that cell's *padding box* on that side only — and
`.cellInner` (the actual colored square) is absolutely positioned via
`inset: 1.5px` relative to that padding box. So every cell touching a
divider rendered its visible square measurably narrower/shorter than a
non-bordered cell, on the divider side only — that asymmetric shrink,
not the divider *pattern* itself, is what produced the "jagged, in one
direction" look; the divider lines themselves were already perfectly
continuous (the board is a zero-gap CSS grid). Fixed by repainting the
same lines with `box-shadow: inset` instead of `border` — visually
identical, but `box-shadow` never participates in the box model, so
`.cellInner` is now exactly the same size on every cell regardless of
which sides carry a divider. Verified directly: every cell's computed
`cellInner` width/height collapses to a single value across all 81 cells
in a live browser, divider or not.

### Achievements system

`packages/shared/src/achievements.ts` is a data-driven catalogue (same
pattern as `themes.ts`) of 14 achievements — the mandatory "first 5000
points," the 3 repeatable examples given verbatim (7-day login streak,
7-day 1000+/day score streak, 50000 points/week), and 10 invented ones
spanning first-line-clear, first-perfect-clear, two combo tiers, two
lifetime-piece-count tiers, a single-run high score, a "clean" high score
(no power-up used), owning every premium theme, and a repeatable
5-perfect-clears-in-a-week. Each has a `condition` (one of eleven kinds —
single-run stats, a lifetime aggregate, owns-all-themes, or a
daily/weekly window) and a `reward` (a flat inventory grant, or — for the
mandatory achievement only — "unlock this theme for free, or these items
instead if it's already owned").

Evaluation lives in `apps/api/src/services/achievements.ts`, called from
two places: `/api/run/finish` (every `run_*` condition, plus the
lifetime/owns-all-themes/daily-window ones, using the just-verified run's
stats) and `/api/session` (just `login_streak`, off the login-streak
number `grantDailyGiftIfNeeded` already computes). A repeatable
achievement's only persisted state beyond `timesCompleted` is
`progress.lastAwardedDay` — a day-gate that stops a *sustained* condition
(a week-long streak that keeps holding, a rolling sum that stays above
threshold) from re-awarding on every single evaluation; it re-arms once
`condition.days` have passed since the last award, deliberately mirroring
`dailyGift.ts`'s existing `streak % STREAK_BONUS_EVERY_DAYS` cadence
rather than inventing a new one. `daily_score_streak`/`weekly_total_score`/
`weekly_perfect_clears` needed `dailyStats` to actually track cumulative
per-day totals — it had `bestScore`/`runs` columns that were *never
written* past their initial insert (dead scaffolding); added
`totalScore`/`perfectClears` columns and now upsert all of it at run/finish
time. `GET /api/achievements` recomputes live progress on every read (best
single-run stats via one aggregate query, a rolling 7-day window via a
date-ranged sum, the real current daily-score streak length via a capped
lookback) rather than caching a progress number anywhere, since none of
these reads are hot paths.

Tested at the service level for the reward-branching logic (`evaluateRunAchievements`
called directly with a constructed run context) rather than via a fully
legitimate high-scoring replayed run — the existing greedy test bot
(`autoplayGreedy`, built for the milestone tests' 1000-point threshold)
turns out to rarely clear high enough to hit 5000 within a practical
number of attempts, since difficulty escalation bites hard at that range;
the reward logic itself doesn't care how a qualifying score was reached,
so testing it directly against the service is both faster and more
deterministic. The `weekly_50000` test does go through the full HTTP
round trip (`/api/session` → `/api/run/finish`), pre-seeding six days of
`dailyStats` directly and letting a real (trivial) run supply the seventh
— that's what actually proves the run/finish → `evaluateRunAchievements` →
`dailyStats` upsert wiring holds together end to end.

### "Pure game" indicator

The engine's `GameState.powerupsUsed` counter already existed and was
already live in the store — this needed no new engine or store work, just
a UI consumer: a small badge next to the score, shown while
`game.powerupsUsed === 0`, gone the instant it isn't.

### Monochrome missing from the Shop, revisited: same root cause, now with harder evidence

Reported again, more pointedly, after last round's deployment-timing
explanation — worth re-verifying rather than repeating the same answer.
Re-checked every layer between the database and the Shop screen: the
`GET /api/shop` query, the `active=true` filter, `seedShopSkus`'s upsert,
nginx's `/api/` proxy (no caching directives on it at all — only
`/assets/` and `/` have `Cache-Control` rules), and the frontend's
`getShop()` (a plain uncached `fetch`, refired fresh every time the Shop
mounts) — all confirmed clean, so the staleness has to be server-side.
Found the *mechanism*, not just the theory this time: `docker/
api.Dockerfile` bundles `packages/shared`'s real TypeScript source
straight into the api image via esbuild at *build* time (`apps/api/
build.mjs` — the api never sees `@nonet/shared` as an installed package,
it inlines the source because that package points `main` at source, not
a compiled artifact). That means the api image's copy of
`PREMIUM_THEMES` — and therefore what `seedShopSkus()` seeds into
`shop_skus` — is frozen at whatever `themes.ts` contained when the
**api** image was last built, completely independent of whether the
**web** image has since been rebuilt with Monochrome in it. Concrete
diagnostic for next time: `docker compose exec nonet-api grep -c
monochrome dist/index.js` (0 means the running api image predates
Monochrome); fix is `docker compose build api web && docker compose up
-d api web` — rebuilding only `web` will never fix this, no matter how
many times it's redeployed.

### Verified with headless Chromium (Vite dev server + real Postgres + Fastify dev server + mocked Telegram WebApp)

9 checks: Achievements screen opens from the main menu and lists all 14
achievements including the mandatory one; a fresh run shows the "Pure
game" badge; the 3 dealt pieces' grab hit-areas (measured via real
`getBoundingClientRect()`) never overlap each other; every board cell's
`cellInner` collapses to one identical width and one identical height
across all 81 cells regardless of which carry a 3x3 divider, with at
least some cells confirmed to actually carry one. All 9 passed. 113
engine tests, 62 API tests (including 5 new achievement tests), `tsc
--noEmit` across every package, and a full workspace `vite build` all
pass/succeed.
