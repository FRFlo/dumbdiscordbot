import { Agent } from "./agent/agent";
import { loadConfig } from "./config";
import { DiscordAdapter } from "./discord/discord-adapter";
import { logger } from "./observability/logger";
import { PostHogObservability } from "./observability/posthog";
import { ToolRegistry } from "./tools/registry";

const config = loadConfig();
const observability = new PostHogObservability(config, logger);
const tools = new ToolRegistry();
await tools.loadFromDirectory();
const agent = new Agent(config, tools, logger, observability);
const discord = new DiscordAdapter(config, agent, logger, observability);

let shuttingDown = false;
const shutdown = async (exitCode: number): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  await observability.shutdown();
  discord.client.destroy();
  process.exit(exitCode);
};

process.on("uncaughtException", (error) => {
  logger.error("Exception non interceptée", { error: String(error) });
  observability.captureError(error, { area: "process.uncaught_exception" });
  void shutdown(1);
});
process.on("unhandledRejection", (reason) => {
  logger.error("Promesse rejetée sans gestionnaire", { error: String(reason) });
  observability.captureError(reason, { area: "process.unhandled_rejection" });
  void shutdown(1);
});
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

await discord.start();
