import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// §16: no web fonts on the critical path, route-split later phases (shop/leaderboard)
// add their own chunks once they exist; single origin means no preconnect needed.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
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
