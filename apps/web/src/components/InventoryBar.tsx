import type { PowerupKind } from "@nonet/shared";
import { POWERUP_ICON } from "../utils/powerupIcon.js";
import styles from "./InventoryBar.module.css";

const POWERUPS: ReadonlyArray<{ kind: PowerupKind; label: string }> = [
  { kind: "pencil", label: "Pencil — remove a cell" },
  { kind: "eraser", label: "Eraser — clear a 2x2 area" },
  { kind: "rocket", label: "Rocket — clear a row or column" },
  { kind: "bomb", label: "Bomb — clear a row and column" },
  { kind: "fill", label: "Fill — fill an empty pocket" },
];

interface InventoryBarProps {
  readonly inventory: Record<string, number>;
  readonly armed: PowerupKind | null;
  readonly onArm: (kind: PowerupKind | null) => void;
}

export function InventoryBar({ inventory, armed, onArm }: InventoryBarProps) {
  return (
    <div className={styles.bar}>
      {POWERUPS.map(({ kind, label }) => {
        const count = inventory[kind] ?? 0;
        const Icon = POWERUP_ICON[kind];
        return (
          <button
            key={kind}
            type="button"
            className={styles.slot}
            data-armed={armed === kind}
            data-empty={count === 0}
            disabled={count === 0}
            aria-label={`${label} (${count} available)${armed === kind ? ", armed" : ""}`}
            aria-pressed={armed === kind}
            onClick={() => onArm(armed === kind ? null : kind)}
          >
            <Icon aria-hidden="true" size={20} />
            <span className={styles.count}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
