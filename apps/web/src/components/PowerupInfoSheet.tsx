import { useTranslation } from "react-i18next";
import { Heart } from "lucide-react";
import type { PowerupKind } from "@nonet/shared";
import { POWERUP_ICON } from "../utils/powerupIcon.js";

export type InventoryItemKind = PowerupKind | "revive";

/** Revive isn't a PowerupKind (it's never armed on the board), so it needs its own icon entry here. */
export const INVENTORY_ITEM_ICON: Record<InventoryItemKind, (typeof POWERUP_ICON)["pencil"]> = {
  ...POWERUP_ICON,
  revive: Heart,
};

/**
 * "What does this item do", as a bottom sheet.
 *
 * Shared by the in-game tray (opened by long-press, so a plain tap can still
 * arm the power-up) and the main menu (opened by a plain tap, since nothing
 * there competes for the gesture) — §19 round 8.
 */
export function PowerupInfoSheet({ kind, onClose }: { kind: InventoryItemKind; onClose: () => void }) {
  const { t } = useTranslation();
  const Icon = INVENTORY_ITEM_ICON[kind];
  return (
    <div className="fixed inset-0 z-[650] flex items-end bg-black/40" onClick={onClose} role="presentation">
      <div
        className="w-full rounded-t-2xl border-t border-border bg-card p-5 text-card-foreground shadow-lg"
        style={{ paddingBottom: "calc(20px + var(--nonet-safe-bottom))" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t(`inventory.${kind}`)}
      >
        <div className="mb-2 flex items-center gap-2">
          <Icon className="h-5 w-5" aria-hidden="true" />
          <span className="text-base font-semibold">{t(`inventory.${kind}`)}</span>
        </div>
        <p className="text-sm text-muted-foreground">{t(`inventory.${kind}Desc`)}</p>
      </div>
    </div>
  );
}
