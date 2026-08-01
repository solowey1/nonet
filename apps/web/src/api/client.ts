import {
  type Action,
  type InventoryConsumeResponse,
  type PowerupKind,
  type RunFinishResponse,
  type RunStartResponse,
  type SessionResponse,
  inventoryConsumeResponseSchema,
  runCheckpointResponseSchema,
  runFinishResponseSchema,
  runStartResponseSchema,
  sessionResponseSchema,
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
