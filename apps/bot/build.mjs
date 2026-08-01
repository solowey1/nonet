/**
 * See apps/api/build.mjs for the full rationale — same deal here: esbuild
 * inlines the workspace source (none currently imported by the bot, but this
 * keeps both services' build story identical) while real npm dependencies
 * (grammy, fastify, zod) stay external for the runtime image to install.
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith("@nonet/"));

await build({
  entryPoints: ["src/index.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external,
});

console.log("built:", external.length, "packages kept external:", external.join(", "));
