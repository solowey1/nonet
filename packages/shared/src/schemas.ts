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

const placeActionSchema = z.object({
  t: z.number().int().nonnegative(),
  type: z.literal("place"),
  slot: slotSchema,
  r: z.number().int(),
  c: z.number().int(),
});

const pencilActionSchema = z.object({
  t: z.number().int().nonnegative(),
  type: z.literal("powerup"),
  kind: z.literal("pencil"),
  r: z.number().int(),
  c: z.number().int(),
});

const eraserActionSchema = z.object({
  t: z.number().int().nonnegative(),
  type: z.literal("powerup"),
  kind: z.literal("eraser"),
  r: z.number().int(),
  c: z.number().int(),
});

const rocketActionSchema = z.object({
  t: z.number().int().nonnegative(),
  type: z.literal("powerup"),
  kind: z.literal("rocket"),
  orientation: rocketOrientationSchema,
  index: z.number().int().min(0).max(8),
});

const bombActionSchema = z.object({
  t: z.number().int().nonnegative(),
  type: z.literal("powerup"),
  kind: z.literal("bomb"),
  r: z.number().int(),
  c: z.number().int(),
});

const fillActionSchema = z.object({
  t: z.number().int().nonnegative(),
  type: z.literal("powerup"),
  kind: z.literal("fill"),
  r: z.number().int(),
  c: z.number().int(),
});

export const actionSchema = z.union([
  placeActionSchema,
  pencilActionSchema,
  eraserActionSchema,
  rocketActionSchema,
  bombActionSchema,
  fillActionSchema,
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
});

export const sessionResponseSchema = z.object({
  token: z.string(),
  user: userSchema,
  inventory: z.record(z.string(), z.number().int().nonnegative()),
  activeRun: activeRunSchema.nullable(),
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
  drops: z.array(z.string()),
  rank: z.number().int().positive().nullable(),
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
});

export type Action = z.infer<typeof actionSchema>;
export type SessionRequest = z.infer<typeof sessionRequestSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type User = z.infer<typeof userSchema>;
export type RunStartResponse = z.infer<typeof runStartResponseSchema>;
export type RunCheckpointRequest = z.infer<typeof runCheckpointRequestSchema>;
export type RunFinishRequest = z.infer<typeof runFinishRequestSchema>;
export type RunFinishResponse = z.infer<typeof runFinishResponseSchema>;
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
