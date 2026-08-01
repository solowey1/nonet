/**
 * Bundles the API into a couple of self-contained ESM files with esbuild.
 *
 * Why not just `tsc`: `@nonet/engine`/`@nonet/shared` are workspace packages
 * whose `package.json` points straight at TypeScript source (great for dev —
 * tsx/vite/vitest all transpile on the fly, so editing the engine is
 * instantly visible everywhere). A plain `node dist/index.js` in the
 * production image can't do that — Node won't execute a `.ts` file just
 * because some package's `main` field points at one. esbuild resolves and
 * inlines those workspace sources at bundle time, so the *real* npm
 * dependencies (fastify, drizzle-orm, postgres, ...) stay external — installed
 * normally in the runtime image — while the workspace packages disappear
 * into the bundle entirely. Two outputs: the server and the standalone
 * migration script the container runs on boot (§18).
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith("@nonet/"));

await build({
  entryPoints: ["src/index.ts", "src/db/migrate.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external,
});

console.log("built:", external.length, "packages kept external:", external.join(", "));
