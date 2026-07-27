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

Only step 1 (the engine, `packages/engine`) is done. `packages/shared`,
`apps/web`, `apps/api`, `apps/bot`, and `docker/` don't exist yet — they're
steps 2+ and come after this step is reviewed.
