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
