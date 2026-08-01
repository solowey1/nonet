import { buildApp } from "./app.js";
import { env } from "./env.js";

const app = buildApp();

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then((address) => {
    app.log.info(`nonet api listening on ${address}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
