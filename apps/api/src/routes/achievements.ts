import { achievementsResponseSchema } from "@nonet/shared";
import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { getAchievementsSnapshot } from "../services/achievements.js";

export async function achievementsRoutes(app: FastifyInstance) {
  app.get("/api/achievements", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = request.userId as bigint;
    const achievements = await getAchievementsSnapshot(db, userId);
    return reply.send(achievementsResponseSchema.parse({ achievements }));
  });
}
