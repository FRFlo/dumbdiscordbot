import { Client, Collection, GatewayIntentBits, Partials } from "discord.js";
import type { Agent } from "../agent/agent";
import type { AppConfig } from "../config";
import type { Logger } from "../observability/logger";
import type { PostHogObservability } from "../observability/posthog";
import { FollowUpState } from "./follow-up";
import type { QuestionManager } from "./question";

export function createDiscordClient(
	agent: Agent,
	logger: Logger,
	observability: PostHogObservability,
	config: AppConfig,
	questions: QuestionManager,
): Client {
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.GuildMembers,
			GatewayIntentBits.GuildModeration,
			GatewayIntentBits.GuildInvites,
			GatewayIntentBits.GuildVoiceStates,
			GatewayIntentBits.GuildPresences,
			GatewayIntentBits.GuildExpressions,
			GatewayIntentBits.AutoModerationConfiguration,
			GatewayIntentBits.GuildScheduledEvents,
			GatewayIntentBits.GuildMessageReactions,
			GatewayIntentBits.DirectMessages,
		],
		partials: [Partials.Channel, Partials.Message, Partials.Reaction],
	});
	client.commands = new Collection();
	client.buttons = new Collection();
	client.contextMenus = new Collection();
	client.cooldowns = new Collection();
	client.agent = agent;
	client.logger = logger;
	client.observability = observability;
	client.followUps = new FollowUpState(config.followUpTimeoutMs, config.sessionDatabasePath);
	client.questions = questions;
	return client;
}
