import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateTestDb, resetTestDb } from "./helpers/db.js";
import { buildSignedInitData } from "./helpers/telegram.js";

// createInvoiceLink hits the real Telegram Bot API — the one deliberate
// exception to testing against real infra, since there's no local stand-in
// for Telegram's servers.
vi.mock("../src/telegram/botApi.js", () => ({
  createInvoiceLink: vi.fn().mockResolvedValue("https://t.me/$mock-invoice-link"),
}));

const { buildApp } = await import("../src/app.js");
const { env } = await import("../src/env.js");
const { createInvoiceLink } = await import("../src/telegram/botApi.js");

const app = buildApp();

beforeAll(async () => {
  await migrateTestDb();
  await app.ready();
});

beforeEach(async () => {
  await resetTestDb();
  vi.mocked(createInvoiceLink).mockClear();
});

afterAll(async () => {
  await app.close();
});

async function sessionFor(userId: number): Promise<string> {
  const initData = buildSignedInitData(env.BOT_TOKEN, { id: userId, username: `user${userId}` });
  const res = await app.inject({ method: "POST", url: "/api/session", payload: { initData } });
  return res.json().token as string;
}

describe("GET /api/shop", () => {
  it("lists the seeded, active SKUs", async () => {
    const res = await app.inject({ method: "GET", url: "/api/shop" });
    expect(res.statusCode).toBe(200);
    const { skus } = res.json();
    const bySku = Object.fromEntries(skus.map((s: { sku: string }) => [s.sku, s]));
    expect(bySku.pencil_5).toMatchObject({ starsAmount: 15, contents: { pencil: 5 } });
    expect(bySku.eraser_5).toMatchObject({ starsAmount: 30, contents: { eraser: 5 } });
    expect(bySku.rocket_3).toMatchObject({ starsAmount: 45, contents: { rocket: 3 } });
    expect(bySku.bomb_3).toMatchObject({ starsAmount: 60, contents: { bomb: 3 } });
    expect(bySku.fill_3).toMatchObject({ starsAmount: 90, contents: { fill: 3 } });
    expect(bySku.revive).toMatchObject({ starsAmount: 30, contents: {} });
    // Bundles (§19 round 8) — five/ten of everything, revives included.
    expect(bySku.toolbox).toMatchObject({
      starsAmount: 249,
      contents: { pencil: 5, eraser: 5, rocket: 5, bomb: 5, fill: 5, revive: 5 },
    });
    expect(bySku.toolcrate).toMatchObject({
      starsAmount: 449,
      contents: { pencil: 10, eraser: 10, rocket: 10, bomb: 10, fill: 10, revive: 10 },
    });
    // Bulk-stockable revive tiers — separate SKUs from the game-over-only
    // "revive" above, each a genuine inventory grant.
    expect(bySku.revive_3).toMatchObject({ starsAmount: 79, contents: { revive: 3 } });
    expect(bySku.revive_10).toMatchObject({ starsAmount: 249, contents: { revive: 10 } });
    expect(bySku.revive_25).toMatchObject({ starsAmount: 599, contents: { revive: 25 } });
    // Withdrawn in round 8 — a re-seed must retire them, not leave them on sale.
    for (const gone of ["fill_1", "revive_1", "revive_5", "revive_20"]) {
      expect(bySku[gone], `${gone} should no longer be listed`).toBeUndefined();
    }
    // §19 settings: purchasable cosmetic themes, seeded from packages/shared's
    // PREMIUM_THEMES — same generic SKU/inventory pipeline as the powerups above.
    expect(bySku.theme_sunset).toMatchObject({ starsAmount: 60, contents: { theme_sunset: 1 } });
    expect(bySku.theme_ocean).toMatchObject({ starsAmount: 60, contents: { theme_ocean: 1 } });
    expect(bySku.theme_neon).toMatchObject({ starsAmount: 60, contents: { theme_neon: 1 } });
    expect(bySku.theme_monochrome).toMatchObject({ starsAmount: 60, contents: { theme_monochrome: 1 } });
  });

  it("returns SKUs in the catalogue's own display order, not the database's", async () => {
    const res = await app.inject({ method: "GET", url: "/api/shop" });
    const order: string[] = res.json().skus.map((s: { sku: string }) => s.sku);
    // Bundles lead, then singles cheapest-first, then revive tiers, then themes.
    const expectedHead = [
      "toolbox",
      "toolcrate",
      "pencil_5",
      "eraser_5",
      "rocket_3",
      "bomb_3",
      "fill_3",
      "revive_3",
      "revive_10",
      "revive_25",
    ];
    expect(order.slice(0, expectedHead.length)).toEqual(expectedHead);
    expect(order.filter((s) => s.startsWith("theme_"))).toEqual([
      "theme_sunset",
      "theme_ocean",
      "theme_neon",
      "theme_monochrome",
      // Retrowave is 120 stars (it ships sounds + effects, not just a palette),
      // so it sits after the 60-star ones (§19 round 9).
      "theme_retrowave",
    ]);
  });
});

describe("POST /api/shop/invoice", () => {
  it("rejects without a session token", async () => {
    const res = await app.inject({ method: "POST", url: "/api/shop/invoice", payload: { sku: "pencil_5" } });
    expect(res.statusCode).toBe(401);
  });

  it("mints an invoice link and a pending purchase for a plain SKU", async () => {
    const token = await sessionFor(1);
    const res = await app.inject({
      method: "POST",
      url: "/api/shop/invoice",
      headers: { authorization: `Bearer ${token}` },
      payload: { sku: "pencil_5" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.invoiceLink).toBe("https://t.me/$mock-invoice-link");
    expect(body.purchaseId).toMatch(/^[0-9a-f-]{36}$/);
    expect(createInvoiceLink).toHaveBeenCalledWith(
      expect.objectContaining({ title: "5 Pencils", starsAmount: 15 }),
    );
  });

  it("rejects an unknown or inactive SKU", async () => {
    const token = await sessionFor(2);
    const res = await app.inject({
      method: "POST",
      url: "/api/shop/invoice",
      headers: { authorization: `Bearer ${token}` },
      payload: { sku: "does_not_exist" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("requires a runId for the revive SKU", async () => {
    const token = await sessionFor(3);
    const res = await app.inject({
      method: "POST",
      url: "/api/shop/invoice",
      headers: { authorization: `Bearer ${token}` },
      payload: { sku: "revive" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("revive_requires_run_id");
  });

  it("rejects a revive invoice for a run that isn't open or isn't the caller's", async () => {
    const token = await sessionFor(4);
    const res = await app.inject({
      method: "POST",
      url: "/api/shop/invoice",
      headers: { authorization: `Bearer ${token}` },
      payload: { sku: "revive", runId: "00000000-0000-7000-8000-000000000000" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("mints a revive invoice for the caller's own open run", async () => {
    const token = await sessionFor(5);
    const startRes = await app.inject({
      method: "POST",
      url: "/api/run/start",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const { runId } = startRes.json();

    const res = await app.inject({
      method: "POST",
      url: "/api/shop/invoice",
      headers: { authorization: `Bearer ${token}` },
      payload: { sku: "revive", runId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().purchaseId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
