/**
 * API contract (§10): every payload crossing the wire is validated with
 * these zod schemas, on both the Fastify routes and (eventually) the
 * client's fetch layer. Mirrors `@nonet/engine`'s `Action` union exactly —
 * duplicated rather than derived from the engine's TS types because zod
 * needs runtime shape, not just compile-time types, and the engine package
 * stays dependency-free (no zod import there).
 */
import { z } from "zod";

const slotSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const rocketOrientationSchema = z.union([z.literal("row"), z.literal("col")]);

export const powerupKindSchema = z.union([
  z.literal("pencil"),
  z.literal("eraser"),
  z.literal("rocket"),
  z.literal("bomb"),
  z.literal("fill"),
]);

// Revive is a stockable inventory item (§19 round 5: bulk shop tiers) but
// NOT a `PowerupKind` — it's never armed/used on the board, it's a distinct
// engine action type (see reviveActionSchema) consumed only from the
// game-over screen. `consumableItemSchema` is the wider set /api/inventory/
// consume accepts: the 5 board powerups plus this one.
export const consumableItemSchema = z.union([powerupKindSchema, z.literal("revive")]);

const placeActionSchema = z.object({
  t: z.number().int().nonnegative(),
  type: z.literal("place"),
  slot: slotSchema,
  r: z.number().int(),
  c: z.number().int(),
});

// consumeToken (§9): the id of the inventory_ledger row `/api/inventory/consume`
// wrote when this power-up was activated — required so a tampered log can't
// claim a power-up use that was never actually charged against inventory.
const pencilActionSchema = z.object({
  t: z.number().int().nonnegative(),
  type: z.literal("powerup"),
  kind: z.literal("pencil"),
  r: z.number().int(),
  c: z.number().int(),
  consumeToken: z.string(),
});

const eraserActionSchema = z.object({
  t: z.number().int().nonnegative(),
  type: z.literal("powerup"),
  kind: z.literal("eraser"),
  r: z.number().int(),
  c: z.number().int(),
  consumeToken: z.string(),
});

const rocketActionSchema = z.object({
  t: z.number().int().nonnegative(),
  type: z.literal("powerup"),
  kind: z.literal("rocket"),
  orientation: rocketOrientationSchema,
  index: z.number().int().min(0).max(8),
  consumeToken: z.string(),
});

const bombActionSchema = z.object({
  t: z.number().int().nonnegative(),
  type: z.literal("powerup"),
  kind: z.literal("bomb"),
  r: z.number().int(),
  c: z.number().int(),
  consumeToken: z.string(),
});

const fillActionSchema = z.object({
  t: z.number().int().nonnegative(),
  type: z.literal("powerup"),
  kind: z.literal("fill"),
  r: z.number().int(),
  c: z.number().int(),
  consumeToken: z.string(),
});

// consumeToken here is the *paid* `purchases` row's id — proof this revive
// was actually bought, checked the same way a power-up's consumeToken proves
// it was actually consumed from inventory (§9's principle, extended to §8's
// revive SKU rather than the five power-up items).
const reviveActionSchema = z.object({
  t: z.number().int().nonnegative(),
  type: z.literal("revive"),
  consumeToken: z.string(),
});

export const actionSchema = z.union([
  placeActionSchema,
  pencilActionSchema,
  eraserActionSchema,
  rocketActionSchema,
  bombActionSchema,
  fillActionSchema,
  reviveActionSchema,
]);

export const actionLogSchema = z.array(actionSchema).max(5000);

// --- POST /api/session ---

export const sessionRequestSchema = z.object({
  initData: z.string().min(1),
});

export const userSchema = z.object({
  id: z.string(), // telegram user id, bigint serialised as a string over the wire
  username: z.string().nullable(),
  firstName: z.string().nullable(),
  photoUrl: z.string().nullable(),
  languageCode: z.string().nullable(),
  isPremium: z.boolean(),
});

export const activeRunSchema = z.object({
  runId: z.string().uuid(),
  seedHex: z.string(),
  actions: actionLogSchema,
  // A fresh run token scoped to this run, so a resumed client can keep
  // calling checkpoint/finish/inventory-consume without a separate exchange.
  runToken: z.string(),
});

export const dailyGiftSchema = z.object({
  granted: z.boolean(),
  items: z.array(powerupKindSchema),
  streak: z.number().int().nonnegative(),
});

export const sessionResponseSchema = z.object({
  token: z.string(),
  user: userSchema,
  inventory: z.record(z.string(), z.number().int().nonnegative()),
  activeRun: activeRunSchema.nullable(),
  dailyGift: dailyGiftSchema,
  // The `t.me` deep link that launches this Mini App, for share cards (§19
  // round 7). Server-built (only the api knows the bot's username, from
  // BOT_USERNAME) and delivered here rather than baked into the web bundle,
  // so changing it is a config edit and an api restart — not a web rebuild.
  // Null when BOT_USERNAME isn't configured; the client then shares its own
  // origin, exactly as it did before.
  miniAppUrl: z.string().nullable(),
});

// --- POST /api/run/start ---

export const runStartResponseSchema = z.object({
  runId: z.string().uuid(),
  seedHex: z.string(),
  runToken: z.string(),
});

// --- POST /api/run/checkpoint ---

export const runCheckpointRequestSchema = z.object({
  runId: z.string().uuid(),
  actions: actionLogSchema,
});

export const runCheckpointResponseSchema = z.object({
  ok: z.literal(true),
});

// --- POST /api/run/finish ---

export const runFinishRequestSchema = z.object({
  runId: z.string().uuid(),
  actions: actionLogSchema,
});

export const runFinishResponseSchema = z.object({
  score: z.number().int().nonnegative(),
  verified: z.boolean(),
  // Every milestone drop earned during the run (§8) — informational, for the
  // game-over screen; items were already granted at milestone time, not here.
  drops: z.array(powerupKindSchema),
  rank: z.number().int().positive().nullable(),
  // Achievement ids newly unlocked by this run (§19 round 4) — rewards were
  // already granted server-side; this is just what to toast on game-over.
  unlockedAchievements: z.array(z.string()),
});

// --- POST /api/run/milestone ---

export const dropItemSchema = z.union([powerupKindSchema, z.literal("nothing")]);

export const runMilestoneRequestSchema = z.object({
  runId: z.string().uuid(),
  // Which 1000-point milestone this is (1 = first crossing, 2 = second, ...) —
  // the server independently re-derives the score from `actions` via replay,
  // this is just which roll is being requested so a repeat call is idempotent.
  milestone: z.number().int().positive(),
  actions: actionLogSchema,
});

export const runMilestoneResponseSchema = z.object({
  drop: dropItemSchema,
  remaining: z.number().int().nonnegative(),
});

// --- POST /api/session/dev (non-production only — see DECISIONS.md) ---

export const devSessionRequestSchema = z.object({
  userId: z.number().int().positive(),
  username: z.string().optional(),
});

// --- POST /api/inventory/consume ---

export const inventoryConsumeRequestSchema = z.object({
  runId: z.string().uuid(),
  item: consumableItemSchema,
});

export const inventoryConsumeResponseSchema = z.object({
  consumeToken: z.string(),
  remaining: z.number().int().nonnegative(),
});

// --- GET /api/shop, POST /api/shop/invoice ---

export const skuSchema = z.object({
  sku: z.string(),
  title: z.string(),
  description: z.string(),
  starsAmount: z.number().int().positive(),
  // e.g. { pencil: 5 } for pencil_5, or {} for revive (revive isn't an
  // inventory item — it directly re-opens a run; see the invoice handler).
  contents: z.record(z.string(), z.number().int().positive()),
});

export const shopResponseSchema = z.object({
  skus: z.array(skuSchema),
});

export const shopInvoiceRequestSchema = z.object({
  sku: z.string(),
  // Required only for the 'revive' SKU — which dead run this revive is for.
  runId: z.string().uuid().optional(),
});

export const shopInvoiceResponseSchema = z.object({
  invoiceLink: z.string(),
  // Held by the client so that, once WebApp.openInvoice reports status==='paid'
  // (§13, optimistic — the webhook stays the source of truth), it can build
  // the matching 'revive' action locally with this as its consumeToken.
  purchaseId: z.string().uuid(),
});

// --- GET /api/leaderboard ---

export const leaderboardScopeSchema = z.union([z.literal("daily"), z.literal("weekly"), z.literal("all_time")]);

export const leaderboardQuerySchema = z.object({
  scope: leaderboardScopeSchema.default("all_time"),
  pure: z.coerce.boolean().default(false),
  around: z.coerce.number().int().positive().optional(),
});

export const leaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  userId: z.string(),
  username: z.string().nullable(),
  photoUrl: z.string().nullable(),
  score: z.number().int().nonnegative(),
  achievedAt: z.string(),
});

export const leaderboardResponseSchema = z.object({
  entries: z.array(leaderboardEntrySchema),
  me: leaderboardEntrySchema.nullable(),
});

// --- GET /api/profile ---

export const profileResponseSchema = z.object({
  stats: z.object({
    runsPlayed: z.number().int().nonnegative(),
    piecesPlaced: z.number().int().nonnegative(),
    perfectClears: z.number().int().nonnegative(),
  }),
  bestRun: z
    .object({
      score: z.number().int().nonnegative(),
      achievedAt: z.string(),
    })
    .nullable(),
  streak: z.number().int().nonnegative(),
  // §14/§7 stub: a linked TON Connect wallet address, for future Gram
  // reward payouts — null if the player has never connected one.
  tonAddress: z.string().nullable(),
});

// --- POST /api/profile/wallet (§14: TON Connect wallet link stub) ---

// Accepts either TON's "user-friendly" base64url address form (as TonConnect
// UI reports it) or the raw `workchain:hex` form — permissive on purpose,
// since the wallet itself is the source of truth for validity, not this regex.
export const tonAddressSchema = z
  .string()
  .regex(/^(-?\d+:[0-9a-fA-F]{64}|[A-Za-z0-9_-]{48})$/, "not a recognizable TON address");

export const walletLinkRequestSchema = z.object({
  tonAddress: tonAddressSchema.nullable(), // null disconnects
});

export const walletLinkResponseSchema = z.object({
  tonAddress: z.string().nullable(),
});

// --- GET /api/achievements (§19 round 4) ---

export const achievementProgressSchema = z.object({
  id: z.string(),
  repeatable: z.boolean(),
  unlocked: z.boolean(),
  timesCompleted: z.number().int().nonnegative(),
  lastCompletedAt: z.string().nullable(),
  // `current`/`target` are always on the *same* scale as the achievement's
  // condition threshold (a score, a piece count, a day count, ...) so the UI
  // can render one generic "current / target" bar for every achievement
  // without knowing what kind of condition backs it.
  progress: z.object({
    current: z.number().nonnegative(),
    target: z.number().nonnegative(),
  }),
});

export const achievementsResponseSchema = z.object({
  achievements: z.array(achievementProgressSchema),
});

export type PowerupKind = z.infer<typeof powerupKindSchema>;
export type ConsumableItem = z.infer<typeof consumableItemSchema>;
export type Action = z.infer<typeof actionSchema>;
export type InventoryConsumeRequest = z.infer<typeof inventoryConsumeRequestSchema>;
export type InventoryConsumeResponse = z.infer<typeof inventoryConsumeResponseSchema>;
export type SessionRequest = z.infer<typeof sessionRequestSchema>;
export type DevSessionRequest = z.infer<typeof devSessionRequestSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type DailyGift = z.infer<typeof dailyGiftSchema>;
export type ActiveRun = z.infer<typeof activeRunSchema>;
export type User = z.infer<typeof userSchema>;
export type RunStartResponse = z.infer<typeof runStartResponseSchema>;
export type RunCheckpointRequest = z.infer<typeof runCheckpointRequestSchema>;
export type RunFinishRequest = z.infer<typeof runFinishRequestSchema>;
export type RunFinishResponse = z.infer<typeof runFinishResponseSchema>;
export type DropItem = z.infer<typeof dropItemSchema>;
export type RunMilestoneRequest = z.infer<typeof runMilestoneRequestSchema>;
export type RunMilestoneResponse = z.infer<typeof runMilestoneResponseSchema>;
export type Sku = z.infer<typeof skuSchema>;
export type ShopResponse = z.infer<typeof shopResponseSchema>;
export type ShopInvoiceRequest = z.infer<typeof shopInvoiceRequestSchema>;
export type ShopInvoiceResponse = z.infer<typeof shopInvoiceResponseSchema>;
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type WalletLinkRequest = z.infer<typeof walletLinkRequestSchema>;
export type WalletLinkResponse = z.infer<typeof walletLinkResponseSchema>;
export type AchievementProgress = z.infer<typeof achievementProgressSchema>;
export type AchievementsResponse = z.infer<typeof achievementsResponseSchema>;
