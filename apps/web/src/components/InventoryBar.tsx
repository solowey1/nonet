import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Heart } from "lucide-react";
import type { PowerupKind } from "@nonet/shared";
import { formatCount } from "../utils/formatCount.js";
import { POWERUP_ICON } from "../utils/powerupIcon.js";
import { cn } from "@/lib/utils";

const LONG_PRESS_MS = 450;

type ItemKind = PowerupKind | "revive";

interface ItemDef {
  readonly kind: ItemKind;
  readonly descKey: string;
  /** Revive is shown here (with its count) but is never armable on the board — it's only spent from the game-over screen. */
  readonly armable: boolean;
}

const ITEMS: readonly ItemDef[] = [
  { kind: "pencil", descKey: "inventory.pencilDesc", armable: true },
  { kind: "eraser", descKey: "inventory.eraserDesc", armable: true },
  { kind: "rocket", descKey: "inventory.rocketDesc", armable: true },
  { kind: "bomb", descKey: "inventory.bombDesc", armable: true },
  { kind: "fill", descKey: "inventory.fillDesc", armable: true },
  { kind: "revive", descKey: "inventory.reviveDesc", armable: false },
];

const ITEM_ICON: Record<ItemKind, (typeof POWERUP_ICON)["pencil"]> = { ...POWERUP_ICON, revive: Heart };

function PowerupInfoSheet({ kind, onClose }: { kind: ItemKind; onClose: () => void }) {
  const { t } = useTranslation();
  const Icon = ITEM_ICON[kind];
  const nameKey = `inventory.${kind}`;
  const descKey = `inventory.${kind}Desc`;
  return (
    // A bottom sheet, not a centered dialog: reachable via a long-press
    // without derailing the current game the way navigating away to a full
    // screen would (§19 round 5) — tap the backdrop (or anywhere outside the
    // sheet) to dismiss.
    <div className="fixed inset-0 z-[650] flex items-end bg-black/40" onClick={onClose} role="presentation">
      <div
        className="w-full rounded-t-2xl border-t border-border bg-card p-5 text-card-foreground shadow-lg"
        style={{ paddingBottom: "calc(20px + var(--nonet-safe-bottom))" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t(nameKey)}
      >
        <div className="mb-2 flex items-center gap-2">
          <Icon className="h-5 w-5" aria-hidden="true" />
          <span className="text-base font-semibold">{t(nameKey)}</span>
        </div>
        <p className="text-sm text-muted-foreground">{t(descKey)}</p>
      </div>
    </div>
  );
}

interface InventoryBarProps {
  readonly inventory: Record<string, number>;
  readonly armed: PowerupKind | null;
  readonly onArm: (kind: PowerupKind | null) => void;
}

/**
 * The count is a separate label *outside* each button, not sitting inside
 * it — the button itself stays a plain square (icon only) rather than
 * stretching to fit an icon+text stack. Portrait puts the count below the
 * square; landscape (the whole bar becomes a column in the left rail — see
 * App.module.css) puts it to the button's right instead, since a 3-4 digit
 * count wouldn't fit under a narrow column icon without wrapping (§19).
 *
 * A long-press (not a tap — a tap already arms the powerup) opens a bottom
 * sheet with what that item actually does (§19 round 5): a normal tap/click
 * still arms/disarms exactly as before, so the description is reachable
 * without adding a permanent extra control that would crowd the tray during
 * play. `suppressClick` stops the click event a touch/mouse release
 * synthesizes right after a long-press from *also* toggling arm/disarm.
 */
export function InventoryBar({ inventory, armed, onArm }: InventoryBarProps) {
  const { t } = useTranslation();
  const [infoFor, setInfoFor] = useState<ItemKind | null>(null);
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
      <div className="flex justify-center gap-3 p-1 landscape:flex-col landscape:items-stretch landscape:justify-start landscape:gap-2.5">
        {ITEMS.map(({ kind, descKey, armable }) => {
          const count = inventory[kind] ?? 0;
          const Icon = ITEM_ICON[kind];
          const label = t(descKey);
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
