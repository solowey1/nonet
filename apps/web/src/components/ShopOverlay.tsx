import { useEffect, useState } from "react";
import type { Sku } from "@nonet/shared";
import { getShop, postShopInvoice } from "../api/client.js";
import { openInvoice } from "../telegram/webapp.js";
import styles from "./ShopOverlay.module.css";

const ITEM_EMOJI: Record<string, string> = {
  pencil: "✏️",
  eraser: "🧹",
  rocket: "🚀",
  bomb: "💣",
  fill: "🪣",
};

function contentsLabel(contents: Record<string, number>): string {
  return Object.entries(contents)
    .map(([item, qty]) => `${ITEM_EMOJI[item] ?? item} x${qty}`)
    .join("  ");
}

interface ShopOverlayProps {
  readonly sessionToken: string;
  readonly onClose: () => void;
  readonly onPurchased: () => Promise<void>;
}

type PurchaseState = { readonly sku: string; readonly status: "buying" | "error" | "done" } | null;

export function ShopOverlay({ sessionToken, onClose, onPurchased }: ShopOverlayProps) {
  const [skus, setSkus] = useState<readonly Sku[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [purchase, setPurchase] = useState<PurchaseState>(null);

  useEffect(() => {
    let cancelled = false;
    getShop()
      .then((res) => {
        if (!cancelled) setSkus(res.skus.filter((s) => s.sku !== "revive")); // revive is only offered from the game-over screen
      })
      .catch((err) => {
        console.error("failed to load the shop", err);
        if (!cancelled) setLoadError("Couldn't load the shop.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const buy = async (sku: Sku) => {
    setPurchase({ sku: sku.sku, status: "buying" });
    try {
      const invoice = await postShopInvoice(sessionToken, sku.sku);
      const status = await openInvoice(invoice.invoiceLink);
      if (status !== "paid") {
        setPurchase(null);
        return;
      }
      setPurchase({ sku: sku.sku, status: "done" });
      // §13: the webhook that actually credits inventory can lag this
      // optimistic "paid" signal by a moment — give it a beat before refetching.
      setTimeout(() => void onPurchased(), 1500);
    } catch (err) {
      console.error("purchase failed", err);
      setPurchase({ sku: sku.sku, status: "error" });
    }
  };

  return (
    <div className={styles.overlay} role="dialog" aria-label="Shop">
      <div className={styles.header}>
        <span className={styles.title}>Shop</span>
        <button type="button" className={styles.close} aria-label="Close shop" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className={styles.list}>
        {loadError && <div className={styles.error}>{loadError}</div>}
        {!skus && !loadError && <div className={styles.loading}>Loading…</div>}
        {skus?.map((sku) => {
          const state = purchase?.sku === sku.sku ? purchase.status : null;
          return (
            <div key={sku.sku} className={styles.item}>
              <div className={styles.itemInfo}>
                <div className={styles.itemTitle}>{sku.title}</div>
                <div className={styles.itemContents}>{contentsLabel(sku.contents)}</div>
              </div>
              <button
                type="button"
                className={styles.buy}
                disabled={state === "buying"}
                onClick={() => void buy(sku)}
              >
                {state === "buying" ? "…" : state === "done" ? "✓ Bought" : `⭐ ${sku.starsAmount}`}
              </button>
              {state === "error" && <div className={styles.itemError}>Purchase failed.</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
