import { useState } from "react";
import type { PowerupKind } from "@nonet/shared";
import { useGameStore } from "../store/gameStore.js";
import { hapticSelection, isHapticsEnabled, setHapticsEnabled } from "../telegram/webapp.js";
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
  // Read once on mount rather than kept in the store — this is a device
  // preference (synced via Telegram CloudStorage, see webapp.ts), not game
  // state, and by the time this screen can render, bootstrap's own
  // (fire-and-forget) preference load has almost always already resolved.
  const [hapticsOn, setHapticsOn] = useState(() => isHapticsEnabled());

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
        onClick={() => {
          hapticSelection();
          if (hasActiveRun) continueRun();
          else void newRun();
        }}
      >
        {hasActiveRun ? (gameStatus === "gameover" ? "▶️ Resume (Game Over)" : "▶️ Continue") : "▶️ Play"}
      </button>
      {hasActiveRun && (
        <button
          type="button"
          className={styles.secondaryText}
          onClick={() => {
            hapticSelection();
            void newRun();
          }}
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
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => {
            hapticSelection();
            setLeaderboardOpen(true);
          }}
        >
          🏆 Leaderboard
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => {
            hapticSelection();
            setShopOpen(true);
          }}
        >
          🛍 Shop
        </button>
      </div>

      <label className={styles.settingsToggle}>
        <input
          type="checkbox"
          checked={hapticsOn}
          onChange={(e) => {
            const next = e.target.checked;
            setHapticsOn(next);
            setHapticsEnabled(next);
            if (next) hapticSelection(); // immediate confirmation that it's back on
          }}
        />
        Haptic feedback
      </label>

      {shopOpen && sessionToken && (
        <ShopOverlay sessionToken={sessionToken} onClose={() => setShopOpen(false)} onPurchased={refreshInventory} />
      )}
      {leaderboardOpen && (
        <LeaderboardScreen sessionToken={sessionToken} profile={profile} onClose={() => setLeaderboardOpen(false)} />
      )}
    </div>
  );
}
