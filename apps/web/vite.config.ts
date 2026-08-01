import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// §16: no web fonts on the critical path, route-split later phases (shop/leaderboard)
// add their own chunks once they exist; single origin means no preconnect needed.
export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    cssMinify: true,
  },
});
