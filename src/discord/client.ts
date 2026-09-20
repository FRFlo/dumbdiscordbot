import { Client, Collection, GatewayIntentBits } from "discord.js";
import type { Agent } from "../agent/agent";
import type { Logger } from "../observability/logger";

export function createDiscordClient(agent: Agent, logger: Logger): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });
  client.commands = new Collection();
  client.buttons = new Collection();
  client.contextMenus = new Collection();
  client.cooldowns = new Collection();
  client.agent = agent;
  client.logger = logger;
  return client;
}
