import {
  type Action,
  type AchievementsResponse,
  type InventoryConsumeResponse,
  type LeaderboardResponse,
  type PowerupKind,
  type ProfileResponse,
  type RunFinishResponse,
  type RunStartResponse,
  type SessionResponse,
  type ShopInvoiceResponse,
  type ShopResponse,
  type WalletLinkResponse,
  achievementsResponseSchema,
  inventoryConsumeResponseSchema,
  leaderboardResponseSchema,
  profileResponseSchema,
  runCheckpointResponseSchema,
  runFinishResponseSchema,
  runStartResponseSchema,
  sessionResponseSchema,
  shopInvoiceResponseSchema,
  shopResponseSchema,
  walletLinkResponseSchema,
} from "@nonet/shared";

const API_BASE = "/api";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function postJson<T>(path: string, payload: unknown, token: string | null, schema: { parse: (v: unknown) => T }): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json);
  return schema.parse(json);
}

async function getJson<T>(path: string, token: string | null, schema: { parse: (v: unknown) => T }): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json);
  return schema.parse(json);
}

export function postSession(initData: string): Promise<SessionResponse> {
  return postJson("/session", { initData }, null, sessionResponseSchema);
}

/** Dev-only: mints a session without initData. The server 404s this route entirely unless ALLOW_DEV_SESSION is set. */
export function postDevSession(userId: number, username?: string): Promise<SessionResponse> {
  return postJson("/session/dev", { userId, username }, null, sessionResponseSchema);
}

export function postRunStart(sessionToken: string): Promise<RunStartResponse> {
  return postJson("/run/start", {}, sessionToken, runStartResponseSchema);
}

export async function postRunCheckpoint(runToken: string, runId: string, actions: readonly Action[]): Promise<void> {
  await postJson("/run/checkpoint", { runId, actions }, runToken, runCheckpointResponseSchema);
}

/**
 * Best-effort checkpoint fired when the app is about to close or background
 * (see gameStore's visibilitychange/pagehide wiring). `keepalive` lets the
 * browser finish the request even after this page itself is torn down —
 * unlike `navigator.sendBeacon`, `fetch` with `keepalive` still supports the
 * `Authorization` header the run-token auth needs, so no server-side change
 * was needed to add this. Fire-and-forget: there's nothing left to react to
 * a response (or a failure) once the app is already closing.
 */
export function sendCheckpointBeacon(runToken: string, runId: string, actions: readonly Action[]): void {
  fetch(`${API_BASE}/run/checkpoint`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${runToken}` },
    body: JSON.stringify({ runId, actions }),
    keepalive: true,
  }).catch(() => {});
}

export function postRunFinish(runToken: string, runId: string, actions: readonly Action[]): Promise<RunFinishResponse> {
  return postJson("/run/finish", { runId, actions }, runToken, runFinishResponseSchema);
}

export function postInventoryConsume(
  runToken: string,
  runId: string,
  item: PowerupKind,
): Promise<InventoryConsumeResponse> {
  return postJson("/inventory/consume", { runId, item }, runToken, inventoryConsumeResponseSchema);
}

export function getShop(): Promise<ShopResponse> {
  return getJson("/shop", null, shopResponseSchema);
}

export function getAchievements(sessionToken: string): Promise<AchievementsResponse> {
  return getJson("/achievements", sessionToken, achievementsResponseSchema);
}

export function postShopInvoice(sessionToken: string, sku: string, runId?: string): Promise<ShopInvoiceResponse> {
  return postJson("/shop/invoice", runId ? { sku, runId } : { sku }, sessionToken, shopInvoiceResponseSchema);
}

export function getLeaderboard(
  params: { scope?: "daily" | "weekly" | "all_time"; pure?: boolean },
  sessionToken: string | null,
): Promise<LeaderboardResponse> {
  const query = new URLSearchParams();
  if (params.scope) query.set("scope", params.scope);
  if (params.pure) query.set("pure", "true");
  const qs = query.toString();
  return getJson(`/leaderboard${qs ? `?${qs}` : ""}`, sessionToken, leaderboardResponseSchema);
}

export function getProfile(sessionToken: string): Promise<ProfileResponse> {
  return getJson("/profile", sessionToken, profileResponseSchema);
}

/** `tonAddress: null` disconnects the linked wallet (§14 stub — address capture only). */
export function postWalletLink(sessionToken: string, tonAddress: string | null): Promise<WalletLinkResponse> {
  return postJson("/profile/wallet", { tonAddress }, sessionToken, walletLinkResponseSchema);
}
