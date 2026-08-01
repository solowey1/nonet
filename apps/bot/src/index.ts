import { bot } from "./bot.js";
import { env } from "./env.js";
import { buildServer } from "./server.js";

async function main() {
  if (env.PUBLIC_WEBHOOK_URL) {
    await bot.api.setWebhook(env.PUBLIC_WEBHOOK_URL, { secret_token: env.WEBHOOK_SECRET });
  }

  const app = buildServer();
  const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`nonet bot listening on ${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
