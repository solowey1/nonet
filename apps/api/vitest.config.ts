import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setupEnv.ts"],
    // DB-backed integration tests share one Postgres instance and truncate
    // between tests — run serially to avoid cross-test interference.
    fileParallelism: false,
  },
});
