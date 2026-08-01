import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// §16: no web fonts on the critical path, route-split later phases (shop/leaderboard)
// add their own chunks once they exist; single origin means no preconnect needed.
export default defineConfig({
  plugins: [react()],
  server: {
    // Mirrors nginx's production routing (docker/nginx/nginx.conf): the SPA
    // talks to a same-origin /api — proxied here to the local api dev server.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    target: "es2022",
    cssMinify: true,
  },
});
