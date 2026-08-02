import fastifyRateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "./plugins/auth.js";
import { env } from "./env.js";
import { internalRoutes } from "./routes/internal.js";
import { inventoryRoutes } from "./routes/inventory.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { milestoneRoutes } from "./routes/milestone.js";
import { profileRoutes } from "./routes/profile.js";
import { runRoutes } from "./routes/run.js";
import { sessionRoutes } from "./routes/session.js";
import { shopRoutes } from "./routes/shop.js";
import { tonconnectRoutes } from "./routes/tonconnect.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : true,
    trustProxy: true, // single nginx vhost in front (§18) — trust its X-Forwarded-* headers
  });

  app.register(authPlugin);
  app.register(fastifyRateLimit, { global: false });

  app.register(sessionRoutes);
  app.register(runRoutes);
  app.register(inventoryRoutes);
  app.register(shopRoutes);
  app.register(milestoneRoutes);
  app.register(internalRoutes);
  app.register(leaderboardRoutes);
  app.register(profileRoutes);
  app.register(tonconnectRoutes);

  app.get("/api/healthz", async () => ({ ok: true }));

  return app;
}
