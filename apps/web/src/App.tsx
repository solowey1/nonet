import { useEffect, useRef, useState } from "react";
import { Home, Store } from "lucide-react";
import type { PowerupKind } from "@nonet/shared";
import { Board } from "./components/Board.js";
import { ComboPopup } from "./components/ComboPopup.js";
import { DragLayer } from "./components/DragLayer.js";
import { GameOverOverlay } from "./components/GameOverOverlay.js";
import { HandTray } from "./components/HandTray.js";
import { InventoryBar } from "./components/InventoryBar.js";
import { LeaderboardScreen } from "./components/LeaderboardScreen.js";
import { MainMenu } from "./components/MainMenu.js";
import { RocketGutters } from "./components/RocketGutters.js";
import { ScoreHud } from "./components/ScoreHud.js";
import { SettingsScreen } from "./components/SettingsScreen.js";
import { ShopOverlay } from "./components/ShopOverlay.js";
import { useCellSize } from "./hooks/useCellSize.js";
import { useDragPlacement } from "./hooks/useDragPlacement.js";
import { usePowerupTargeting, type TargetingState } from "./hooks/usePowerupTargeting.js";
import { useGameStore } from "./store/gameStore.js";
import { hideBackButton, initSettingsButton, showBackButton } from "./telegram/webapp.js";
import styles from "./App.module.css";

export function App() {
  const boardRef = useRef<HTMLDivElement>(null);
  const bootStatus = useGameStore((s) => s.bootStatus);
  const bootError = useGameStore((s) => s.bootError);
  const bootstrap = useGameStore((s) => s.bootstrap);
  const screen = useGameStore((s) => s.screen);

  useEffect(() => {
    void bootstrap();
    // bootstrap runs once on mount — it's not meant to re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every screen but the menu is exactly one level deep, so the native
  // BackButton always routes back to the menu (goToMenu also checkpoints if
  // the screen being left is "game" — see gameStore). SettingsButton is a
  // persistent control registered once, not toggled per screen.
  useEffect(() => {
    if (bootStatus !== "ready") return;
    if (screen === "menu") hideBackButton();
    else showBackButton(() => useGameStore.getState().goToMenu());
  }, [screen, bootStatus]);

  useEffect(() => {
    if (bootStatus !== "ready") return;
    initSettingsButton(() => useGameStore.getState().goToSettings());
  }, [bootStatus]);

  if (bootStatus === "loading") {
    return (
      <div className={styles.boot}>
        <p>Loading NONET…</p>
      </div>
    );
  }

  if (bootStatus === "error") {
    return (
      <div className={styles.boot}>
        <p className={styles.bootError}>Couldn&apos;t start a session.</p>
        <p>{bootError}</p>
        <button type="button" className={styles.bootRetry} onClick={() => void bootstrap()}>
          Retry
        </button>
      </div>
    );
  }

  switch (screen) {
    case "menu":
      return <MainMenu />;
    case "leaderboard":
      return <LeaderboardPage />;
    case "shop":
      return <ShopPage />;
    case "settings":
      return <SettingsScreen />;
    case "game":
      return <Game boardRef={boardRef} />;
  }
}

function LeaderboardPage() {
  const sessionToken = useGameStore((s) => s.sessionToken);
  const profile = useGameStore((s) => s.profile);
  const goToMenu = useGameStore((s) => s.goToMenu);
  return <LeaderboardScreen sessionToken={sessionToken} profile={profile} onClose={goToMenu} />;
}

function ShopPage() {
  const sessionToken = useGameStore((s) => s.sessionToken);
  const refreshInventory = useGameStore((s) => s.refreshInventory);
  const goToMenu = useGameStore((s) => s.goToMenu);
  if (!sessionToken) return null; // shouldn't happen once bootStatus is "ready"
  return <ShopOverlay sessionToken={sessionToken} onClose={goToMenu} onPurchased={refreshInventory} />;
}

function Game({ boardRef }: { boardRef: React.RefObject<HTMLDivElement | null> }) {
  const game = useGameStore((s) => s.game);
  const cellFamilies = useGameStore((s) => s.cellFamilies);
  const lastClear = useGameStore((s) => s.lastClear);
  const inventory = useGameStore((s) => s.inventory);
  const armedPowerup = useGameStore((s) => s.armedPowerup);
  const finishResult = useGameStore((s) => s.finishResult);
  const revivePending = useGameStore((s) => s.revivePending);
  const sessionToken = useGameStore((s) => s.sessionToken);
  const profile = useGameStore((s) => s.profile);
  const armPowerup = useGameStore((s) => s.armPowerup);
  const applyRocket = useGameStore((s) => s.applyRocket);
  const buyRevive = useGameStore((s) => s.buyRevive);
  const refreshInventory = useGameStore((s) => s.refreshInventory);
  const newRun = useGameStore((s) => s.newRun);
  const goToMenu = useGameStore((s) => s.goToMenu);

  const [hint, setHint] = useState<string | null>(null);
  const [shopOpen, setShopOpen] = useState(false);

  const { drag, beginDrag } = useDragPlacement(boardRef);
  const { targeting, beginTargeting } = usePowerupTargeting(boardRef);
  const cellSize = useCellSize(boardRef);

  const draggedPiece = drag ? game.hand[drag.slot] : null;
  const ghost = game.status === "gameover" ? null : (drag?.ghost ?? null);
  const powerupArmedOnBoard = armedPowerup && armedPowerup !== "rocket";

  const onBoardPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!powerupArmedOnBoard) return;
    event.preventDefault();
    beginTargeting(armedPowerup as Exclude<PowerupKind, "rocket">, event.pointerId, event.clientX, event.clientY);
  };

  // Surface the one refusal that's genuinely worth a message: fill's region
  // guard rail (§7 "refuse... and show why"). Re-derived from live preview so
  // it's visible *during* the drag too — and held for a couple seconds after
  // release, since a quick tap-and-release would otherwise clear it (via
  // targeting -> null) before anyone could read it.
  const lastTargetingRef = useRef<TargetingState | null>(null);
  useEffect(() => {
    if (targeting) {
      lastTargetingRef.current = targeting;
      setHint(
        targeting.kind === "fill" && targeting.preview.regionTooLarge
          ? `Region too large (${targeting.preview.regionSize} cells) — pick a smaller pocket`
          : null,
      );
      return;
    }
    const last = lastTargetingRef.current;
    if (last?.kind === "fill" && last.preview.regionTooLarge) {
      const timer = setTimeout(() => setHint(null), 2200);
      return () => clearTimeout(timer);
    }
    setHint(null);
  }, [targeting]);

  const handleRocketFire = async (orientation: "row" | "col", index: number) => {
    const ok = await applyRocket(orientation, index);
    if (!ok) setHint("Couldn't fire — out of rockets?");
  };

  return (
    <div className={styles.app}>
      {/*
        `.hudRow` groups score+controls into one visual row in portrait, but
        `display: contents` in landscape (see App.module.css) makes it
        transparent to the grid — its two children below become independently
        placeable grid items (score left, controls right), matching the
        requested layout without duplicating either subtree.
      */}
      <div className={styles.hudRow}>
        <div className={styles.scoreArea}>
          <ScoreHud
            score={game.score}
            comboLevel={game.comboLevel}
            bestScore={
              profile?.bestRun ? Math.max(profile.bestRun.score, game.score) : game.score > 0 ? game.score : null
            }
          />
        </div>
        <div className={styles.controlsArea}>
          <button type="button" className={styles.shopButton} onClick={goToMenu} aria-label="Back to menu">
            <Home size={18} aria-hidden="true" />
          </button>
          <button type="button" className={styles.shopButton} onClick={() => setShopOpen(true)}>
            <Store size={16} aria-hidden="true" /> Shop
          </button>
        </div>
      </div>

      <div className={styles.inventoryArea}>
        <InventoryBar inventory={inventory} armed={armedPowerup} onArm={armPowerup} />
      </div>

      <div className={styles.hint}>{hint}</div>

      <div className={styles.boardWrap}>
        <Board
          ref={boardRef}
          board={game.board}
          cellFamilies={cellFamilies}
          ghost={ghost}
          powerupPreview={targeting}
          clearEvent={lastClear}
          onPointerDown={onBoardPointerDown}
        />
        {game.status === "gameover" && (
          <GameOverOverlay
            game={game}
            finishResult={finishResult}
            revivePending={revivePending}
            onRestart={() => void newRun()}
            onBuyRevive={buyRevive}
          />
        )}
      </div>

      <div className={styles.trayWrap}>
        <HandTray
          hand={game.hand}
          cellSize={cellSize || 40}
          draggingSlot={drag?.slot ?? null}
          onGrab={powerupArmedOnBoard ? () => undefined : beginDrag}
        />
      </div>

      <DragLayer drag={drag} piece={draggedPiece ?? null} cellSize={cellSize || 40} />
      <ComboPopup clearEvent={lastClear} boardRef={boardRef} />
      <RocketGutters boardRef={boardRef} visible={armedPowerup === "rocket"} onFire={handleRocketFire} />

      {shopOpen && sessionToken && (
        <ShopOverlay
          sessionToken={sessionToken}
          onClose={() => setShopOpen(false)}
          onPurchased={refreshInventory}
        />
      )}
    </div>
  );
}
