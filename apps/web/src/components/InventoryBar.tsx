import type { PowerupKind } from "@nonet/shared";
import styles from "./InventoryBar.module.css";

const POWERUPS: ReadonlyArray<{ kind: PowerupKind; emoji: string; label: string }> = [
  { kind: "pencil", emoji: "✏️", label: "Pencil — remove a cell" },
  { kind: "eraser", emoji: "🧹", label: "Eraser — clear a 2x2 area" },
  { kind: "rocket", emoji: "🚀", label: "Rocket — clear a row or column" },
  { kind: "bomb", emoji: "💣", label: "Bomb — clear a row and column" },
  { kind: "fill", emoji: "🪣", label: "Fill — fill an empty pocket" },
];

interface InventoryBarProps {
  readonly inventory: Record<string, number>;
  readonly armed: PowerupKind | null;
  readonly onArm: (kind: PowerupKind | null) => void;
}

export function InventoryBar({ inventory, armed, onArm }: InventoryBarProps) {
  return (
    <div className={styles.bar}>
      {POWERUPS.map(({ kind, emoji, label }) => {
        const count = inventory[kind] ?? 0;
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
            <span aria-hidden="true">{emoji}</span>
            <span className={styles.count}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
