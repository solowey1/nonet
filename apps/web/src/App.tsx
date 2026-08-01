import { useEffect, useRef, useState } from "react";
import type { PowerupKind } from "@nonet/shared";
import { Board } from "./components/Board.js";
import { ComboPopup } from "./components/ComboPopup.js";
import { DragLayer } from "./components/DragLayer.js";
import { GameOverOverlay } from "./components/GameOverOverlay.js";
import { HandTray } from "./components/HandTray.js";
import { InventoryBar } from "./components/InventoryBar.js";
import { RocketGutters } from "./components/RocketGutters.js";
import { ScoreHud } from "./components/ScoreHud.js";
import { useCellSize } from "./hooks/useCellSize.js";
import { useDragPlacement } from "./hooks/useDragPlacement.js";
import { usePowerupTargeting, type TargetingState } from "./hooks/usePowerupTargeting.js";
import { useGameStore } from "./store/gameStore.js";
import styles from "./App.module.css";

export function App() {
  const boardRef = useRef<HTMLDivElement>(null);
  const bootStatus = useGameStore((s) => s.bootStatus);
  const bootError = useGameStore((s) => s.bootError);
  const bootstrap = useGameStore((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
    // bootstrap runs once on mount — it's not meant to re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return <Game boardRef={boardRef} />;
}

function Game({ boardRef }: { boardRef: React.RefObject<HTMLDivElement | null> }) {
  const game = useGameStore((s) => s.game);
  const cellFamilies = useGameStore((s) => s.cellFamilies);
  const lastClear = useGameStore((s) => s.lastClear);
  const inventory = useGameStore((s) => s.inventory);
  const armedPowerup = useGameStore((s) => s.armedPowerup);
  const finishResult = useGameStore((s) => s.finishResult);
  const armPowerup = useGameStore((s) => s.armPowerup);
  const applyRocket = useGameStore((s) => s.applyRocket);
  const newRun = useGameStore((s) => s.newRun);

  const [hint, setHint] = useState<string | null>(null);

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
      <ScoreHud score={game.score} comboLevel={game.comboLevel} />
      <InventoryBar inventory={inventory} armed={armedPowerup} onArm={armPowerup} />
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
          <GameOverOverlay game={game} finishResult={finishResult} onRestart={() => void newRun()} />
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
    </div>
  );
}
