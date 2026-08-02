import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { env } from "../src/env.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/tonconnect-manifest.json", () => {
  it("serves a manifest built from WEBAPP_URL, unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tonconnect-manifest.json" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      url: env.WEBAPP_URL,
      name: "NONET",
      iconUrl: `${env.WEBAPP_URL}/icon-192.png`,
    });
  });
});
