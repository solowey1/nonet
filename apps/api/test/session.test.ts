import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { env } from "../src/env.js";
import { migrateTestDb, resetTestDb } from "./helpers/db.js";
import { buildSignedInitData } from "./helpers/telegram.js";

const app = buildApp();

beforeAll(async () => {
  await migrateTestDb();
  await app.ready();
});

beforeEach(async () => {
  await resetTestDb();
});

afterAll(async () => {
  await app.close();
});

describe("POST /api/session", () => {
  it("mints a session for validly-signed initData and creates the user", async () => {
    const initData = buildSignedInitData(env.BOT_TOKEN, { id: 12345, username: "alice", first_name: "Alice" });
    const res = await app.inject({ method: "POST", url: "/api/session", payload: { initData } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.id).toBe("12345");
    expect(body.user.username).toBe("alice");
    expect(typeof body.token).toBe("string");
    expect(body.inventory).toEqual({});
    expect(body.activeRun).toBeNull();
  });

  it("rejects a tampered hash", async () => {
    const initData = buildSignedInitData(env.BOT_TOKEN, { id: 1, username: "eve" });
    const tampered = initData.replace(/hash=[a-f0-9]+/, "hash=deadbeef");
    const res = await app.inject({ method: "POST", url: "/api/session", payload: { initData: tampered } });
    expect(res.statusCode).toBe(401);
    expect(res.json().reason).toBe("bad_signature");
  });

  it("rejects initData signed with the wrong bot token", async () => {
    const initData = buildSignedInitData("some-other-bot-token", { id: 2, username: "mallory" });
    const res = await app.inject({ method: "POST", url: "/api/session", payload: { initData } });
    expect(res.statusCode).toBe(401);
    expect(res.json().reason).toBe("bad_signature");
  });

  it("rejects a stale auth_date (older than INIT_DATA_MAX_AGE_SECONDS)", async () => {
    const staleAuthDate = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const initData = buildSignedInitData(env.BOT_TOKEN, { id: 3, username: "stale" }, staleAuthDate);
    const res = await app.inject({ method: "POST", url: "/api/session", payload: { initData } });
    expect(res.statusCode).toBe(401);
    expect(res.json().reason).toBe("stale");
  });

  it("rejects a malformed request body", async () => {
    const res = await app.inject({ method: "POST", url: "/api/session", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("upserts the same user across repeated sessions instead of duplicating", async () => {
    const initData1 = buildSignedInitData(env.BOT_TOKEN, { id: 999, username: "first-name" });
    await app.inject({ method: "POST", url: "/api/session", payload: { initData: initData1 } });

    const initData2 = buildSignedInitData(env.BOT_TOKEN, { id: 999, username: "updated-name" });
    const res2 = await app.inject({ method: "POST", url: "/api/session", payload: { initData: initData2 } });

    expect(res2.statusCode).toBe(200);
    expect(res2.json().user.username).toBe("updated-name");
  });
});
