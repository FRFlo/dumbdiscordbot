import { Agent } from "./agent/agent";
import { loadConfig } from "./config";
import { DiscordAdapter } from "./discord/discord-adapter";
import { logger } from "./observability/logger";
import { ToolRegistry } from "./tools/registry";

const config = loadConfig();
const tools = new ToolRegistry();
const agent = new Agent(config, tools, logger);
const discord = new DiscordAdapter(config, agent, logger);

await discord.start();
