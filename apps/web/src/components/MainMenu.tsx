import { Play, RotateCcw, Settings, Store, Trophy } from "lucide-react";
import { useGameStore } from "../store/gameStore.js";
import { hapticSelection } from "../telegram/webapp.js";
import { POWERUP_ICON } from "../utils/powerupIcon.js";
import styles from "./MainMenu.module.css";

const POWERUP_ORDER = ["pencil", "eraser", "rocket", "bomb", "fill"] as const;

/** §19: Continue/New game, Leaderboard, Shop, Settings — a plain list, not the previous button grid. */
export function MainMenu() {
  const runId = useGameStore((s) => s.runId);
  const gameStatus = useGameStore((s) => s.game.status);
  const inventory = useGameStore((s) => s.inventory);
  const profile = useGameStore((s) => s.profile);
  const newRun = useGameStore((s) => s.newRun);
  const continueRun = useGameStore((s) => s.continueRun);
  const goToLeaderboard = useGameStore((s) => s.goToLeaderboard);
  const goToShop = useGameStore((s) => s.goToShop);
  const goToSettings = useGameStore((s) => s.goToSettings);

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

      <div className={styles.inventoryStrip}>
        {POWERUP_ORDER.map((kind) => {
          const Icon = POWERUP_ICON[kind];
          return (
            <div key={kind} className={styles.invSlot}>
              <Icon size={18} aria-hidden="true" />
              <span className={styles.invCount}>{inventory[kind] ?? 0}</span>
            </div>
          );
        })}
      </div>

      <nav className={styles.list}>
        <button
          type="button"
          className={styles.listItem}
          data-primary="true"
          disabled={!hasActiveRun}
          onClick={() => {
            hapticSelection();
            continueRun();
          }}
        >
          <Play size={20} aria-hidden="true" />
          {hasActiveRun && gameStatus === "gameover" ? "Resume (Game Over)" : "Continue"}
        </button>
        <button
          type="button"
          className={styles.listItem}
          onClick={() => {
            hapticSelection();
            void newRun();
          }}
        >
          <RotateCcw size={20} aria-hidden="true" />
          New game
        </button>
        <button
          type="button"
          className={styles.listItem}
          onClick={() => {
            hapticSelection();
            goToLeaderboard();
          }}
        >
          <Trophy size={20} aria-hidden="true" />
          Leaderboard
        </button>
        <button
          type="button"
          className={styles.listItem}
          onClick={() => {
            hapticSelection();
            goToShop();
          }}
        >
          <Store size={20} aria-hidden="true" />
          Shop
        </button>
        <button
          type="button"
          className={styles.listItem}
          onClick={() => {
            hapticSelection();
            goToSettings();
          }}
        >
          <Settings size={20} aria-hidden="true" />
          Settings
        </button>
      </nav>
    </div>
  );
}
