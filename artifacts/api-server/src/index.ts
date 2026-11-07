import app from "./app";
import { loadPersistedGuildState, startDiscordBot } from "./discord/bot";
import { initDatabase } from "./lib/prisma";
import { syncFromDatabase, syncToDatabase } from "./discord/nwordCounter";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = process.env.WEBSITE_PREVIEW === "true"
  ? app.listen(port, "127.0.0.1")
  : app.listen(port);
server.once("listening", () => onListening());
server.once("error", (error: Error) => onListening(error));

function onListening(err?: Error): void {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  void (async () => {
    if (process.env.WEBSITE_PREVIEW === "true") {
      logger.info({ port }, "Website preview server listening");
      return;
    }
    await initDatabase();
    await syncFromDatabase();
    await syncToDatabase();
    await loadPersistedGuildState();
    logger.info({ port }, "Server listening");
    startDiscordBot();
  })().catch((error: unknown) => {
    logger.error({ err: error }, "Database startup tasks failed");
    process.exit(1);
  });
}
