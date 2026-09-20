import { Agent } from "./agent/agent";
import { loadConfig } from "./config";
import { DiscordAdapter } from "./discord/discord-adapter";
import { logger } from "./observability/logger";
import { PostHogObservability } from "./observability/posthog";
import { ToolRegistry } from "./tools/registry";
import { QuestionManager } from "./discord/question";
import { createApprovalTool } from "./tools/approval";
import { createQuestionTool } from "./tools/question";
import { discordRuntime } from "./tools/discord-runtime";
import { startScheduler, stopScheduler } from "./ecosystem/scheduler";

const config = loadConfig();
const observability = new PostHogObservability(config, logger);
const questions = new QuestionManager(
	config.approvalTimeoutMs,
	config.approvalTokenTtlMs,
	config.codeModeTimeout,
);
discordRuntime.questions = questions;
const tools = new ToolRegistry();
await tools.loadFromDirectory();
tools.register(createQuestionTool(questions));
tools.register(createApprovalTool(questions));
const agent = new Agent(config, tools, logger, observability, questions);
const discord = new DiscordAdapter(config, agent, logger, observability, questions);
discordRuntime.client = discord.client;
questions.attachClient(discord.client);

let shuttingDown = false;
const shutdown = async (exitCode: number): Promise<void> => {
	if (shuttingDown) return;
	shuttingDown = true;
	await observability.shutdown();
	questions.close();
	stopScheduler();
	discord.client.followUps.close();
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
startScheduler(discord.client, agent, config.maxAgentIterations);
