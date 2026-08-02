import type { FastifyInstance } from "fastify";
import { env } from "../env.js";

/**
 * §14 stub: TON Connect's manifest must be a static-looking JSON document at
 * a stable, publicly-fetchable URL (wallets fetch it directly, unauthenticated,
 * cross-origin) — but it also has to embed this deployment's own absolute
 * origin, which isn't known until runtime (§18: the same image is deployed
 * behind whatever domain the operator points at it via WEBAPP_URL). Serving
 * it from the api service lets it read `env.WEBAPP_URL` instead of requiring
 * a hand-edited static file per deployment.
 */
export async function tonconnectRoutes(app: FastifyInstance) {
  app.get("/api/tonconnect-manifest.json", async (_request, reply) => {
    return reply.send({
      url: env.WEBAPP_URL,
      name: "NONET",
      iconUrl: `${env.WEBAPP_URL}/icon-192.png`,
    });
  });
}
