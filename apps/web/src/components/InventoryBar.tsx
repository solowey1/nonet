import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PowerupKind } from "@nonet/shared";
import { formatCount } from "../utils/formatCount.js";
import { cn } from "@/lib/utils";
import {
  INVENTORY_ITEM_ICON,
  PowerupInfoSheet,
  type InventoryItemKind,
} from "./PowerupInfoSheet.js";

const LONG_PRESS_MS = 450;

interface ItemDef {
  readonly kind: InventoryItemKind;
  /** Revive is shown here (with its count) but is never armable on the board — it's only spent from the game-over screen. */
  readonly armable: boolean;
}

const ITEMS: readonly ItemDef[] = [
  { kind: "pencil", armable: true },
  { kind: "eraser", armable: true },
  { kind: "rocket", armable: true },
  { kind: "bomb", armable: true },
  { kind: "fill", armable: true },
  { kind: "revive", armable: false },
];

interface InventoryBarProps {
  readonly inventory: Record<string, number>;
  readonly armed: PowerupKind | null;
  readonly onArm: (kind: PowerupKind | null) => void;
}

/**
 * The count is a separate label *outside* each button, not sitting inside
 * it — the button itself stays a plain square (icon only) rather than
 * stretching to fit an icon+text stack. Portrait is one centered row with the
 * count below each square; landscape is a **two-column grid** in the left rail
 * with the count beside each icon (§19 round 8 — six items in a single column
 * were taller than the rail, and a 3x2 block sits neatly above the labels
 * that now share that corner).
 *
 * A long-press (not a tap — a tap already arms the powerup) opens the shared
 * description sheet. `suppressClick` stops the click event a touch/mouse
 * release synthesizes right after a long-press from *also* toggling
 * arm/disarm.
 */
export function InventoryBar({ inventory, armed, onArm }: InventoryBarProps) {
  const { t } = useTranslation();
  const [infoFor, setInfoFor] = useState<InventoryItemKind | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const clearLongPressTimer = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <>
      <div className="flex justify-center gap-3 p-1 landscape:grid landscape:grid-cols-2 landscape:justify-items-start landscape:gap-x-3 landscape:gap-y-2 landscape:p-0">
        {ITEMS.map(({ kind, armable }) => {
          const count = inventory[kind] ?? 0;
          const Icon = INVENTORY_ITEM_ICON[kind];
          const label = t(`inventory.${kind}Desc`);
          const isArmed = armable && armed === kind;
          return (
            <div
              key={kind}
              className="flex flex-col items-center gap-1 landscape:flex-row landscape:justify-start landscape:gap-2"
            >
              <button
                type="button"
                className={cn(
                  "flex aspect-square h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-transparent bg-muted",
                  isArmed && "border-primary bg-primary/15",
                  (!armable || count === 0) && "cursor-default opacity-35",
                )}
                aria-label={`${label} (${t("inventory.available", { count })})${isArmed ? t("inventory.armedSuffix") : ""}`}
                aria-pressed={armable ? isArmed : undefined}
                onPointerDown={() => {
                  suppressClick.current = false;
                  longPressTimer.current = window.setTimeout(() => {
                    suppressClick.current = true;
                    setInfoFor(kind);
                  }, LONG_PRESS_MS);
                }}
                onPointerUp={clearLongPressTimer}
                onPointerLeave={clearLongPressTimer}
                onPointerCancel={clearLongPressTimer}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  if (!armable || count === 0) return;
                  onArm(armed === kind ? null : (kind as PowerupKind));
                }}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </button>
              <span className="text-[0.65rem] font-bold text-muted-foreground landscape:text-xs">
                {formatCount(count, t("common.thousandsSuffix"))}
              </span>
            </div>
          );
        })}
      </div>

      {infoFor && <PowerupInfoSheet kind={infoFor} onClose={() => setInfoFor(null)} />}
    </>
  );
}
