import fastifyJwt from "@fastify/jwt";
import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../env.js";

export interface SessionTokenPayload {
  readonly sub: string; // Telegram user id, as a string (bigint doesn't survive JSON)
}

export interface RunTokenPayload extends SessionTokenPayload {
  readonly runId: string;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    authenticateRun(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    optionalAuthenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
  interface FastifyRequest {
    userId?: bigint;
    runId?: string;
  }
}

/** Registers `@fastify/jwt` plus two preHandlers: session-scoped and run-scoped auth. */
export const authPlugin = fp(async (app) => {
  await app.register(fastifyJwt, { secret: env.JWT_SECRET });

  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await request.jwtVerify<SessionTokenPayload>();
      request.userId = BigInt(payload.sub);
    } catch {
      await reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.decorate("authenticateRun", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await request.jwtVerify<RunTokenPayload>();
      request.userId = BigInt(payload.sub);
      request.runId = payload.runId;
    } catch {
      await reply.code(401).send({ error: "unauthorized" });
    }
  });

  // For routes that are public but personalise their response when a valid
  // token is present (e.g. the leaderboard's "me" entry) — never rejects.
  app.decorate("optionalAuthenticate", async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      const payload = await request.jwtVerify<SessionTokenPayload>();
      request.userId = BigInt(payload.sub);
    } catch {
      // no/invalid token: proceed unauthenticated
    }
  });
});
