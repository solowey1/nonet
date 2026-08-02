import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { reduce, type Action } from "@nonet/engine";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/client.js";
import { inventoryBalance, purchases, runs } from "../src/db/schema.js";
import { env } from "../src/env.js";
import { autoplay, continueGreedy } from "./helpers/autoplay.js";
import { migrateTestDb, resetTestDb } from "./helpers/db.js";
import { buildSignedInitData } from "./helpers/telegram.js";
import { hexToBytes } from "../src/utils/hex.js";

const app = buildApp();
const SECRET_HEADERS = { "x-internal-secret": env.INTERNAL_API_SECRET };

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

async function sessionFor(userId: number): Promise<string> {
  const initData = buildSignedInitData(env.BOT_TOKEN, { id: userId, username: `user${userId}` });
  const res = await app.inject({ method: "POST", url: "/api/session", payload: { initData } });
  return res.json().token as string;
}

async function insertPendingPurchase(params: {
  userId: bigint;
  sku: string;
  starsAmount: number;
  payload: string;
  runId?: string;
}): Promise<string> {
  const [row] = await db
    .insert(purchases)
    .values({
      userId: params.userId,
      sku: params.sku,
      starsAmount: params.starsAmount,
      payload: params.payload,
      status: "pending",
      runId: params.runId ?? null,
    })
    .returning({ id: purchases.id });
  return (row as { id: string }).id;
}

describe("GET /api/internal/purchases/validate", () => {
  it("rejects without the internal secret header", async () => {
    const res = await app.inject({ method: "GET", url: "/api/internal/purchases/validate?payload=x&sku=pencil_5&amount=25" });
    expect(res.statusCode).toBe(401);
  });

  it("valid:true for a matching pending purchase", async () => {
    await sessionFor(1);
    await insertPendingPurchase({ userId: 1n, sku: "pencil_5", starsAmount: 25, payload: "1:pencil_5:aaa" });

    const res = await app.inject({
      method: "GET",
      url: "/api/internal/purchases/validate?payload=1:pencil_5:aaa&sku=pencil_5&amount=25",
      headers: SECRET_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: true });
  });

  it("valid:false for a payload that doesn't exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/internal/purchases/validate?payload=nope&sku=pencil_5&amount=25",
      headers: SECRET_HEADERS,
    });
    expect(res.json()).toEqual({ valid: false, reason: "no_such_purchase" });
  });

  it("valid:false once the purchase is no longer pending", async () => {
    await sessionFor(2);
    await insertPendingPurchase({ userId: 2n, sku: "pencil_5", starsAmount: 25, payload: "2:pencil_5:bbb" });
    await app.inject({
      method: "POST",
      url: "/api/internal/stars-payment",
      headers: { ...SECRET_HEADERS, "content-type": "application/json" },
      payload: { payload: "2:pencil_5:bbb", telegramPaymentChargeId: "charge-bbb", starsAmount: 25 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/internal/purchases/validate?payload=2:pencil_5:bbb&sku=pencil_5&amount=25",
      headers: SECRET_HEADERS,
    });
    expect(res.json()).toEqual({ valid: false, reason: "not_pending" });
  });

  it("valid:false on a SKU or amount mismatch", async () => {
    await sessionFor(3);
    await insertPendingPurchase({ userId: 3n, sku: "pencil_5", starsAmount: 25, payload: "3:pencil_5:ccc" });

    const skuMismatch = await app.inject({
      method: "GET",
      url: "/api/internal/purchases/validate?payload=3:pencil_5:ccc&sku=eraser_5&amount=25",
      headers: SECRET_HEADERS,
    });
    expect(skuMismatch.json()).toEqual({ valid: false, reason: "sku_mismatch" });

    const amountMismatch = await app.inject({
      method: "GET",
      url: "/api/internal/purchases/validate?payload=3:pencil_5:ccc&sku=pencil_5&amount=999",
      headers: SECRET_HEADERS,
    });
    expect(amountMismatch.json()).toEqual({ valid: false, reason: "amount_mismatch" });
  });
});

describe("POST /api/internal/stars-payment", () => {
  it("rejects without the internal secret header", async () => {
    const res = await app.inject({ method: "POST", url: "/api/internal/stars-payment", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("marks the purchase paid and credits inventory per the SKU's contents", async () => {
    await sessionFor(4); // grants a welcome-gift starting balance too — assert the delta, not an absolute count
    const [before] = await db
      .select({ qty: inventoryBalance.qty })
      .from(inventoryBalance)
      .where(and(eq(inventoryBalance.userId, 4n), eq(inventoryBalance.item, "pencil")));
    const startingPencils = before?.qty ?? 0;
    await insertPendingPurchase({ userId: 4n, sku: "pencil_5", starsAmount: 25, payload: "4:pencil_5:ddd" });

    const res = await app.inject({
      method: "POST",
      url: "/api/internal/stars-payment",
      headers: { ...SECRET_HEADERS, "content-type": "application/json" },
      payload: { payload: "4:pencil_5:ddd", telegramPaymentChargeId: "charge-ddd", starsAmount: 25 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, alreadyProcessed: false });

    const [balance] = await db
      .select({ qty: inventoryBalance.qty })
      .from(inventoryBalance)
      .where(and(eq(inventoryBalance.userId, 4n), eq(inventoryBalance.item, "pencil")));
    expect(balance?.qty).toBe(startingPencils + 5);

    const [purchaseRow] = await db.select().from(purchases).where(eq(purchases.payload, "4:pencil_5:ddd"));
    expect(purchaseRow?.status).toBe("paid");
    expect(purchaseRow?.telegramPaymentChargeId).toBe("charge-ddd");
  });

  it("is idempotent on a redelivered charge id — doesn't double-credit", async () => {
    await sessionFor(5);
    const [before] = await db
      .select({ qty: inventoryBalance.qty })
      .from(inventoryBalance)
      .where(and(eq(inventoryBalance.userId, 5n), eq(inventoryBalance.item, "pencil")));
    const startingPencils = before?.qty ?? 0;
    await insertPendingPurchase({ userId: 5n, sku: "pencil_5", starsAmount: 25, payload: "5:pencil_5:eee" });

    const body = { payload: "5:pencil_5:eee", telegramPaymentChargeId: "charge-eee", starsAmount: 25 };
    const first = await app.inject({
      method: "POST",
      url: "/api/internal/stars-payment",
      headers: { ...SECRET_HEADERS, "content-type": "application/json" },
      payload: body,
    });
    expect(first.json()).toEqual({ ok: true, alreadyProcessed: false });

    const second = await app.inject({
      method: "POST",
      url: "/api/internal/stars-payment",
      headers: { ...SECRET_HEADERS, "content-type": "application/json" },
      payload: body,
    });
    expect(second.json()).toEqual({ ok: true, alreadyProcessed: true });

    const [balance] = await db
      .select({ qty: inventoryBalance.qty })
      .from(inventoryBalance)
      .where(and(eq(inventoryBalance.userId, 5n), eq(inventoryBalance.item, "pencil")));
    expect(balance?.qty).toBe(startingPencils + 5); // not +10
  });

  it("reports alreadyProcessed for a payload with no matching pending row, without crashing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/stars-payment",
      headers: { ...SECRET_HEADERS, "content-type": "application/json" },
      payload: { payload: "does:not:exist", telegramPaymentChargeId: "charge-ghost", starsAmount: 25 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, alreadyProcessed: true });
  });

  it("marks the associated run revived for a paid 'revive' purchase", async () => {
    const token = await sessionFor(6);
    const startRes = await app.inject({
      method: "POST",
      url: "/api/run/start",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const { runId } = startRes.json();
    await insertPendingPurchase({ userId: 6n, sku: "revive", starsAmount: 30, payload: "6:revive:fff", runId });

    await app.inject({
      method: "POST",
      url: "/api/internal/stars-payment",
      headers: { ...SECRET_HEADERS, "content-type": "application/json" },
      payload: { payload: "6:revive:fff", telegramPaymentChargeId: "charge-fff", starsAmount: 30 },
    });

    const [run] = await db.select({ revived: runs.revived }).from(runs).where(eq(runs.id, runId));
    expect(run?.revived).toBe(true);
  });
});

describe("revive end to end via /api/run/finish", () => {
  it("a paid revive token lets the run continue and finish verified, with revived=true", async () => {
    const token = await sessionFor(7);
    const startRes = await app.inject({
      method: "POST",
      url: "/api/run/start",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const { runId, seedHex, runToken } = startRes.json();

    // The naive first-legal-position bot (unlike the greedy one) reliably
    // stalls into a real gameover within a modest action budget — exactly
    // what's needed here to exercise revive against a genuine dead run.
    const { actions, finalState } = autoplay(hexToBytes(seedHex), 600);
    expect(finalState.status).toBe("gameover");

    const purchaseId = await insertPendingPurchase({ userId: 7n, sku: "revive", starsAmount: 30, payload: "7:revive:ggg", runId });
    const paymentRes = await app.inject({
      method: "POST",
      url: "/api/internal/stars-payment",
      headers: { ...SECRET_HEADERS, "content-type": "application/json" },
      payload: { payload: "7:revive:ggg", telegramPaymentChargeId: "charge-ggg", starsAmount: 30 },
    });
    expect(paymentRes.json().alreadyProcessed).toBe(false);

    const lastT = (actions[actions.length - 1] as Action).t;
    const reviveAction = { t: lastT + 200, type: "revive" as const, consumeToken: purchaseId };
    const revivedState = reduce(finalState, reviveAction);
    expect(revivedState.status).toBe("playing");

    const { actions: postReviveActions } = continueGreedy(revivedState, reviveAction.t, 20);
    expect(postReviveActions.length).toBeGreaterThan(0);

    const fullActions: unknown[] = [...actions, reviveAction, ...postReviveActions];

    const finishRes = await app.inject({
      method: "POST",
      url: "/api/run/finish",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, actions: fullActions },
    });
    expect(finishRes.statusCode).toBe(200);
    const body = finishRes.json();
    expect(body.verified).toBe(true);

    const [run] = await db.select({ revived: runs.revived, verified: runs.verified }).from(runs).where(eq(runs.id, runId));
    expect(run?.revived).toBe(true);
    expect(run?.verified).toBe(true);
  });

  it("rejects a revive action whose consumeToken points at a purchase that was never paid", async () => {
    const token = await sessionFor(8);
    const startRes = await app.inject({
      method: "POST",
      url: "/api/run/start",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const { runId, seedHex, runToken } = startRes.json();

    // The naive first-legal-position bot (unlike the greedy one) reliably
    // stalls into a real gameover within a modest action budget — exactly
    // what's needed here to exercise revive against a genuine dead run.
    const { actions, finalState } = autoplay(hexToBytes(seedHex), 600);
    expect(finalState.status).toBe("gameover");

    const purchaseId = await insertPendingPurchase({ userId: 8n, sku: "revive", starsAmount: 30, payload: "8:revive:hhh", runId });
    // Deliberately never marked paid — still "pending".

    const lastT = (actions[actions.length - 1] as Action).t;
    const reviveAction = { t: lastT + 200, type: "revive" as const, consumeToken: purchaseId };

    const finishRes = await app.inject({
      method: "POST",
      url: "/api/run/finish",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, actions: [...actions, reviveAction] },
    });
    expect(finishRes.statusCode).toBe(200);
    expect(finishRes.json().verified).toBe(false);
  });
});
