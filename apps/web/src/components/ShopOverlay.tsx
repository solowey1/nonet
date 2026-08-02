import { useEffect, useState } from "react";
import { ArrowLeft, Check, Star } from "lucide-react";
import { PREMIUM_THEMES, themeInventoryKey, type Sku } from "@nonet/shared";
import { getShop, postShopInvoice } from "../api/client.js";
import { openInvoice } from "../telegram/webapp.js";
import { POWERUP_ICON } from "../utils/powerupIcon.js";
import styles from "./ShopOverlay.module.css";

function ContentsLine({ contents }: { contents: Record<string, number> }) {
  const entries = Object.entries(contents).filter(([item]) => !item.startsWith("theme_"));
  if (entries.length === 0) return null;
  return (
    <div className={styles.itemContents}>
      {entries.map(([item, qty]) => {
        const Icon = (POWERUP_ICON as Partial<Record<string, (typeof POWERUP_ICON)["pencil"]>>)[item];
        return (
          <span key={item} className={styles.contentChip}>
            {Icon ? <Icon size={14} aria-hidden="true" /> : item} x{qty}
          </span>
        );
      })}
    </div>
  );
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
        <button type="button" className={styles.close} aria-label="Back" onClick={onClose}>
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <span className={styles.title}>Shop</span>
      </div>
      <div className={styles.list}>
        {loadError && <div className={styles.error}>{loadError}</div>}
        {!skus && !loadError && <div className={styles.loading}>Loading…</div>}
        {skus?.map((sku) => {
          const state = purchase?.sku === sku.sku ? purchase.status : null;
          const theme = PREMIUM_THEMES.find((t) => sku.sku === themeInventoryKey(t.id));
          return (
            <div key={sku.sku} className={styles.item}>
              {theme && (
                <span className={styles.themeSwatch} style={{ background: theme.palette.accent }} aria-hidden="true" />
              )}
              <div className={styles.itemInfo}>
                <div className={styles.itemTitle}>{sku.title}</div>
                {theme ? <div className={styles.itemContents}>{theme.description}</div> : <ContentsLine contents={sku.contents} />}
              </div>
              <button
                type="button"
                className={styles.buy}
                disabled={state === "buying"}
                onClick={() => void buy(sku)}
              >
                {state === "buying" ? (
                  "…"
                ) : state === "done" ? (
                  <>
                    <Check size={16} aria-hidden="true" /> Bought
                  </>
                ) : (
                  <>
                    <Star size={14} aria-hidden="true" /> {sku.starsAmount}
                  </>
                )}
              </button>
              {state === "error" && <div className={styles.itemError}>Purchase failed.</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
