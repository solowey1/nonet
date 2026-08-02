import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/theme.css";
import { App } from "./App.js";
import { useGameStore } from "./store/gameStore.js";

const container = document.getElementById("root");
if (!container) throw new Error("missing #root element");

if (import.meta.env.DEV) {
  // Dev-only escape hatch for manual QA (e.g. forcing a game-over state from
  // the console) — dead-code-eliminated from production builds.
  (window as unknown as { __nonetStore: typeof useGameStore }).__nonetStore = useGameStore;
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
