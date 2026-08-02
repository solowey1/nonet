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
 * The count is a separate label *outside* each button, not sitting inside
 * it — the button itself stays a plain square (icon only) rather than
 * stretching to fit an icon+text stack. Portrait puts the count below the
 * square; landscape (the whole bar becomes a column in the left rail — see
 * App.module.css) puts it to the button's right instead, since a 3-4 digit
 * count wouldn't fit under a narrow column icon without wrapping (§19).
 */
export function InventoryBar({ inventory, armed, onArm }: InventoryBarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-center gap-3 p-1 landscape:flex-col landscape:items-stretch landscape:justify-start landscape:gap-2.5">
      {POWERUPS.map(({ kind, nameKey, descKey }) => {
        const count = inventory[kind] ?? 0;
        const Icon = POWERUP_ICON[kind];
        const label = t(descKey);
        return (
          <div key={kind} className="flex flex-col items-center gap-1 landscape:flex-row landscape:justify-start landscape:gap-2">
            <button
              type="button"
              className={cn(
                "flex aspect-square h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-transparent bg-muted",
                armed === kind && "border-primary bg-primary/15",
                count === 0 && "cursor-default opacity-35",
              )}
              disabled={count === 0}
              aria-label={`${label} (${t("inventory.available", { count })})${armed === kind ? t("inventory.armedSuffix") : ""}`}
              aria-pressed={armed === kind}
              onClick={() => onArm(armed === kind ? null : kind)}
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
  );
}
