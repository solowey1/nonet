import { useState } from "react";
import type { PowerupKind } from "@nonet/shared";
import { useGameStore } from "../store/gameStore.js";
import { LeaderboardScreen } from "./LeaderboardScreen.js";
import { ShopOverlay } from "./ShopOverlay.js";
import styles from "./MainMenu.module.css";

const POWERUPS: ReadonlyArray<{ kind: PowerupKind; emoji: string }> = [
  { kind: "pencil", emoji: "✏️" },
  { kind: "eraser", emoji: "🧹" },
  { kind: "rocket", emoji: "🚀" },
  { kind: "bomb", emoji: "💣" },
  { kind: "fill", emoji: "🪣" },
];

export function MainMenu() {
  const runId = useGameStore((s) => s.runId);
  const gameStatus = useGameStore((s) => s.game.status);
  const inventory = useGameStore((s) => s.inventory);
  const profile = useGameStore((s) => s.profile);
  const sessionToken = useGameStore((s) => s.sessionToken);
  const refreshInventory = useGameStore((s) => s.refreshInventory);
  const newRun = useGameStore((s) => s.newRun);
  const continueRun = useGameStore((s) => s.continueRun);

  const [shopOpen, setShopOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);

  const hasActiveRun = runId !== null;

  return (
    <div className={styles.menu}>
      <div className={styles.title}>NONET</div>
      {profile?.bestRun && (
        <div className={styles.bestScore}>
          <span className={styles.bestLabel}>Best score</span>
          <span className={styles.bestValue}>{profile.bestRun.score.toLocaleString()}</span>
        </div>
      )}

      <button
        type="button"
        className={styles.primary}
        onClick={() => (hasActiveRun ? continueRun() : void newRun())}
      >
        {hasActiveRun ? (gameStatus === "gameover" ? "▶️ Resume (Game Over)" : "▶️ Continue") : "▶️ Play"}
      </button>
      {hasActiveRun && (
        <button
          type="button"
          className={styles.secondaryText}
          onClick={() => void newRun()}
        >
          Start a new game instead
        </button>
      )}

      <div className={styles.inventoryStrip}>
        {POWERUPS.map(({ kind, emoji }) => (
          <div key={kind} className={styles.invSlot}>
            <span aria-hidden="true">{emoji}</span>
            <span className={styles.invCount}>{inventory[kind] ?? 0}</span>
          </div>
        ))}
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.actionButton} onClick={() => setLeaderboardOpen(true)}>
          🏆 Leaderboard
        </button>
        <button type="button" className={styles.actionButton} onClick={() => setShopOpen(true)}>
          🛍 Shop
        </button>
      </div>

      {shopOpen && sessionToken && (
        <ShopOverlay sessionToken={sessionToken} onClose={() => setShopOpen(false)} onPurchased={refreshInventory} />
      )}
      {leaderboardOpen && (
        <LeaderboardScreen sessionToken={sessionToken} profile={profile} onClose={() => setLeaderboardOpen(false)} />
      )}
    </div>
  );
}
