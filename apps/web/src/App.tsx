import { useRef } from "react";
import { Board } from "./components/Board.js";
import { ComboPopup } from "./components/ComboPopup.js";
import { DragLayer } from "./components/DragLayer.js";
import { GameOverOverlay } from "./components/GameOverOverlay.js";
import { HandTray } from "./components/HandTray.js";
import { ScoreHud } from "./components/ScoreHud.js";
import { useDragPlacement } from "./hooks/useDragPlacement.js";
import { useCellSize } from "./hooks/useCellSize.js";
import { useGameStore } from "./store/gameStore.js";
import styles from "./App.module.css";

export function App() {
  const boardRef = useRef<HTMLDivElement>(null);
  const game = useGameStore((s) => s.game);
  const cellFamilies = useGameStore((s) => s.cellFamilies);
  const lastClear = useGameStore((s) => s.lastClear);
  const newRun = useGameStore((s) => s.newRun);

  const { drag, beginDrag } = useDragPlacement(boardRef);
  const cellSize = useCellSize(boardRef);

  const draggedPiece = drag ? game.hand[drag.slot] : null;
  const ghost = game.status === "gameover" ? null : (drag?.ghost ?? null);

  return (
    <div className={styles.app}>
      <ScoreHud score={game.score} comboLevel={game.comboLevel} />

      <div className={styles.boardWrap}>
        <Board ref={boardRef} board={game.board} cellFamilies={cellFamilies} ghost={ghost} clearEvent={lastClear} />
        {game.status === "gameover" && <GameOverOverlay game={game} onRestart={newRun} />}
      </div>

      <div className={styles.trayWrap}>
        <HandTray hand={game.hand} cellSize={cellSize || 40} draggingSlot={drag?.slot ?? null} onGrab={beginDrag} />
      </div>

      <DragLayer drag={drag} piece={draggedPiece ?? null} cellSize={cellSize || 40} />
      <ComboPopup clearEvent={lastClear} boardRef={boardRef} />
    </div>
  );
}
