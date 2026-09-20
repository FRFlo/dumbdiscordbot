import { Agent } from "./agent/agent";
import { loadConfig } from "./config";
import { DiscordAdapter } from "./discord/discord-adapter";
import { logger } from "./observability/logger";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible";
import { SafetyPolicy } from "./safety/policy";
import { ToolRegistry } from "./tools/registry";

const config = loadConfig();
const tools = new ToolRegistry();
const provider = new OpenAiCompatibleProvider(config.openAiModel, config.openAiBaseUrl, config.openAiApiKey);
const agent = new Agent(provider, tools, new SafetyPolicy(), logger, config.maxAgentIterations);
const discord = new DiscordAdapter(config, agent, logger);

await discord.start();
