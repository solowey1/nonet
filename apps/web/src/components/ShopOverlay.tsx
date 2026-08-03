import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, Heart, Star } from "lucide-react";
import { PREMIUM_THEMES, themeInventoryKey, type PremiumThemeDef, type Sku } from "@nonet/shared";
import { getShop, postShopInvoice } from "../api/client.js";
import { openInvoice } from "../telegram/webapp.js";
import { POWERUP_ICON } from "../utils/powerupIcon.js";
import { derivePreviewPalette } from "../utils/themePreview.js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ThemePreviewMock } from "./ThemePreviewMock.js";

function StarIcon({ className }: { className?: string }) {
  return <Star className={className} fill="#FFC335" stroke="#E98615" aria-hidden="true" />;
}

// "revive" isn't a PowerupKind (it's never armed on the board — see
// InventoryBar), so it doesn't live in POWERUP_ICON; this is the one place
// the shop's contents line needs to render it alongside the 5 real powerups.
const CONTENTS_ICON: Partial<Record<string, (typeof POWERUP_ICON)["pencil"]>> = { ...POWERUP_ICON, revive: Heart };

function ContentsLine({ contents }: { contents: Record<string, number> }) {
  const entries = Object.entries(contents).filter(([item]) => !item.startsWith("theme_"));
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
      {entries.map(([item, qty]) => {
        const Icon = CONTENTS_ICON[item];
        return (
          <span key={item} className="inline-flex items-center gap-1">
            {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : item} x{qty}
          </span>
        );
      })}
    </div>
  );
}

interface SkuDescriptionDialogProps {
  readonly sku: Sku;
  readonly owned: boolean;
  readonly buying: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onBuy: () => void;
}

/** Tapping a non-theme item (§19 round 5) shows what it actually contains before buying — themes get their own richer preview dialog above. */
function SkuDescriptionDialog({ sku, owned, buying, onOpenChange, onBuy }: SkuDescriptionDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`shop.skuNames.${sku.sku}`, sku.title)}</DialogTitle>
          <DialogDescription>{t(`shop.skuDescriptions.${sku.sku}`, sku.description)}</DialogDescription>
        </DialogHeader>
        <div className="mt-3">
          <ContentsLine contents={sku.contents} />
        </div>
        <Button className="mt-4 w-full text-white" disabled={owned || buying} onClick={onBuy}>
          {owned ? (
            <>
              <Check className="h-4 w-4" aria-hidden="true" /> {t("shop.previewOwned")}
            </>
          ) : buying ? (
            "…"
          ) : (
            <>
              <StarIcon className="h-4 w-4" /> {t("shop.previewBuy", { price: sku.starsAmount })}
            </>
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

interface ThemePreviewDialogProps {
  readonly theme: PremiumThemeDef;
  readonly owned: boolean;
  readonly buying: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onBuy: () => void;
}

function ThemePreviewDialog({ theme, owned, buying, onOpenChange, onBuy }: ThemePreviewDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"light" | "dark">("dark");
  const previewPalette = derivePreviewPalette(theme.palette, mode);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("shop.previewTitle", { name: t(`shop.themeNames.${theme.id}`) })}</DialogTitle>
        </DialogHeader>
        <div className="mt-2 flex justify-center gap-1 rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => setMode("light")}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === "light" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            {t("shop.previewLight")}
          </button>
          <button
            type="button"
            onClick={() => setMode("dark")}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === "dark" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            {t("shop.previewDark")}
          </button>
        </div>
        <div className="mt-3">
          <ThemePreviewMock palette={previewPalette} />
        </div>
        <Button className="mt-4 w-full text-white" disabled={owned || buying} onClick={onBuy}>
          {owned ? (
            <>
              <Check className="h-4 w-4" aria-hidden="true" /> {t("shop.previewOwned")}
            </>
          ) : buying ? (
            "…"
          ) : (
            <>
              <StarIcon className="h-4 w-4" /> {t("shop.previewBuy", { price: theme.starsAmount })}
            </>
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

interface ShopOverlayProps {
  readonly sessionToken: string;
  readonly inventory: Record<string, number>;
  readonly onClose: () => void;
  readonly onPurchased: () => Promise<void>;
}

type PurchaseState = { readonly sku: string; readonly status: "buying" | "error" | "done" } | null;

export function ShopOverlay({ sessionToken, inventory, onClose, onPurchased }: ShopOverlayProps) {
  const { t } = useTranslation();
  const [skus, setSkus] = useState<readonly Sku[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [purchase, setPurchase] = useState<PurchaseState>(null);
  const [previewThemeId, setPreviewThemeId] = useState<string | null>(null);
  const [previewSkuId, setPreviewSkuId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getShop()
      .then((res) => {
        // "revive" (bare, no suffix) is the game-over screen's own pay-right-
        // now SKU — the bulk revive_1/3/5/20 tiers are genuine shop stock and
        // stay in this list.
        if (!cancelled) setSkus(res.skus.filter((s) => s.sku !== "revive"));
      })
      .catch((err) => {
        console.error("failed to load the shop", err);
        if (!cancelled) setLoadError(t("shop.loadError"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

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

  const previewTheme = previewThemeId ? PREMIUM_THEMES.find((th) => th.id === previewThemeId) : null;
  const previewThemeSku = previewTheme ? skus?.find((s) => s.sku === themeInventoryKey(previewTheme.id)) : null;
  const previewSku = previewSkuId ? skus?.find((s) => s.sku === previewSkuId) : null;

  return (
    <div className="absolute inset-0 z-[600] flex flex-col bg-background" role="dialog" aria-label={t("shop.dialogLabel")}>
      <div
        className="flex items-center gap-2 border-b px-4 pb-2.5"
        style={{ paddingTop: "calc(10px + var(--nonet-safe-top))" }}
      >
        <Button variant="ghost" size="icon" aria-label={t("common.back")} onClick={onClose}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Button>
        <span className="text-sm font-bold uppercase tracking-wide">{t("mainMenu.shop")}</span>
      </div>
      <div
        className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3"
        style={{ paddingBottom: "calc(12px + var(--nonet-safe-bottom))" }}
      >
        {loadError && <div className="py-6 text-center text-muted-foreground">{loadError}</div>}
        {!skus && !loadError && <div className="py-6 text-center text-muted-foreground">{t("common.loading")}</div>}
        {skus?.map((sku) => {
          const state = purchase?.sku === sku.sku ? purchase.status : null;
          const theme = PREMIUM_THEMES.find((th) => sku.sku === themeInventoryKey(th.id));
          const owned = theme ? (inventory[sku.sku] ?? 0) > 0 : false;
          return (
            <div
              key={sku.sku}
              className="relative flex items-center gap-3 rounded-lg bg-muted p-2.5"
              role="button"
              tabIndex={0}
              onClick={() => (theme ? setPreviewThemeId(theme.id) : setPreviewSkuId(sku.sku))}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                if (theme) setPreviewThemeId(theme.id);
                else setPreviewSkuId(sku.sku);
              }}
              style={{ cursor: "pointer" }}
            >
              {theme && (
                <span
                  className="h-7 w-7 shrink-0 rounded-full"
                  style={{ background: theme.palette.accent }}
                  aria-hidden="true"
                />
              )}
              <div className="flex-1">
                <div className="font-semibold">{theme ? t(`shop.themeNames.${theme.id}`) : t(`shop.skuNames.${sku.sku}`, sku.title)}</div>
                {theme ? (
                  <div className="text-sm text-muted-foreground">{t(`shop.themeDescriptions.${theme.id}`)}</div>
                ) : (
                  <ContentsLine contents={sku.contents} />
                )}
              </div>
              <Button
                className="text-white"
                disabled={state === "buying" || owned}
                onClick={(e) => {
                  e.stopPropagation();
                  void buy(sku);
                }}
              >
                {owned ? (
                  <>
                    <Check className="h-4 w-4" aria-hidden="true" /> {t("shop.previewOwned")}
                  </>
                ) : state === "buying" ? (
                  "…"
                ) : state === "done" ? (
                  <>
                    <Check className="h-4 w-4" aria-hidden="true" /> {t("shop.bought")}
                  </>
                ) : (
                  <>
                    <StarIcon className="h-3.5 w-3.5" /> {sku.starsAmount}
                  </>
                )}
              </Button>
              {state === "error" && (
                <div className="absolute -bottom-0.5 right-3 text-xs text-destructive">{t("shop.purchaseFailed")}</div>
              )}
            </div>
          );
        })}
      </div>

      {previewTheme && (
        <ThemePreviewDialog
          theme={previewTheme}
          owned={(inventory[themeInventoryKey(previewTheme.id)] ?? 0) > 0}
          buying={purchase?.sku === themeInventoryKey(previewTheme.id) && purchase.status === "buying"}
          onOpenChange={(open) => {
            if (!open) setPreviewThemeId(null);
          }}
          onBuy={() => {
            if (previewThemeSku) void buy(previewThemeSku);
          }}
        />
      )}

      {previewSku && (
        <SkuDescriptionDialog
          sku={previewSku}
          owned={false}
          buying={purchase?.sku === previewSku.sku && purchase.status === "buying"}
          onOpenChange={(open) => {
            if (!open) setPreviewSkuId(null);
          }}
          onBuy={() => void buy(previewSku)}
        />
      )}
    </div>
  );
}
