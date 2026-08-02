import { useTranslation } from "react-i18next";
import type { PowerupKind } from "@nonet/shared";
import { formatCount } from "../utils/formatCount.js";
import { POWERUP_ICON } from "../utils/powerupIcon.js";
import { cn } from "@/lib/utils";

const POWERUPS: readonly { kind: PowerupKind; nameKey: string; descKey: string }[] = [
  { kind: "pencil", nameKey: "inventory.pencil", descKey: "inventory.pencilDesc" },
  { kind: "eraser", nameKey: "inventory.eraser", descKey: "inventory.eraserDesc" },
  { kind: "rocket", nameKey: "inventory.rocket", descKey: "inventory.rocketDesc" },
  { kind: "bomb", nameKey: "inventory.bomb", descKey: "inventory.bombDesc" },
  { kind: "fill", nameKey: "inventory.fill", descKey: "inventory.fillDesc" },
];

interface InventoryBarProps {
  readonly inventory: Record<string, number>;
  readonly armed: PowerupKind | null;
  readonly onArm: (kind: PowerupKind | null) => void;
}

/**
 * Portrait: a row of icon buttons, count below each icon. Landscape: a
 * vertical column instead (it sits in the left rail alongside the board —
 * see App.module.css), with the count to the *right* of the icon rather
 * than below it, since a 3-4 digit count wouldn't fit under a narrow
 * column icon without wrapping awkwardly (§19).
 */
export function InventoryBar({ inventory, armed, onArm }: InventoryBarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-center gap-2 p-1 landscape:flex-col landscape:items-stretch landscape:justify-start">
      {POWERUPS.map(({ kind, nameKey, descKey }) => {
        const count = inventory[kind] ?? 0;
        const Icon = POWERUP_ICON[kind];
        const label = t(descKey);
        return (
          <button
            key={kind}
            type="button"
            className={cn(
              "flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-transparent bg-muted p-1.5",
              "landscape:min-w-0 landscape:flex-row landscape:justify-start landscape:gap-2 landscape:px-2.5",
              armed === kind && "border-primary bg-primary/15",
              count === 0 && "cursor-default opacity-35",
            )}
            disabled={count === 0}
            aria-label={`${label} (${t("inventory.available", { count })})${armed === kind ? t("inventory.armedSuffix") : ""}`}
            aria-pressed={armed === kind}
            onClick={() => onArm(armed === kind ? null : kind)}
          >
            <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="text-[0.65rem] font-bold text-muted-foreground landscape:text-xs">
              {formatCount(count, t("common.thousandsSuffix"))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
