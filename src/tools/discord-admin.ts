import { ActivityType } from "discord.js";
import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { approve, requireClient, requireGuild } from "./discord-runtime";
import { guildSummary } from "./discord-helpers";

type Exec = { context?: ConversationContext };
const status = toolDefinition({
	name: "get_bot_status",
	description: "Retourne le statut et la latence du bot.",
	inputSchema: z.object({}),
	outputSchema: z.any(),
});
const guilds = toolDefinition({
	name: "list_connected_guilds",
	description: "Liste les serveurs auxquels le bot est connecté.",
	inputSchema: z.object({}),
	outputSchema: z.any(),
});
const presence = toolDefinition({
	name: "set_bot_presence",
	description: "Modifie la présence du bot après approbation.",
	inputSchema: z.object({
		text: z.string().min(1).max(128),
		type: z.enum(["playing", "streaming", "listening", "watching", "competing"]).default("playing"),
		status: z.enum(["online", "idle", "dnd", "invisible"]).default("online"),
	}),
	outputSchema: z.object({ updated: z.boolean() }),
});
const leave = toolDefinition({
	name: "leave_guild",
	description: "Fait quitter un serveur au bot après approbation.",
	inputSchema: z.object({ guildId: z.string(), approvalToken: z.string().optional() }),
	outputSchema: z.object({ left: z.boolean(), id: z.string() }),
});

export default [
	status.server(async () => {
		const client = requireClient();
		return {
			userId: client.user?.id ?? null,
			username: client.user?.username ?? null,
			readyAt: client.readyAt?.toISOString() ?? null,
			ping: client.ws.ping,
			guildCount: client.guilds.cache.size,
		};
	}),
	guilds.server(async () => ({
		guilds: [...requireClient().guilds.cache.values()].map(guildSummary),
	})),
	presence.server(async ({ text, type, status: presenceStatus }) => {
		const client = requireClient();
		const activityType = {
			playing: ActivityType.Playing,
			streaming: ActivityType.Streaming,
			listening: ActivityType.Listening,
			watching: ActivityType.Watching,
			competing: ActivityType.Competing,
		}[type ?? "playing"];
		await client.user?.setPresence({
			activities: [{ name: text, type: activityType }],
			status: presenceStatus ?? "online",
		});
		return { updated: true };
	}),
	leave.server(async ({ guildId, approvalToken }, execution: Exec) => {
		const guild = requireGuild(execution.context, guildId);
		await approve("leave_guild", [guild.id], approvalToken, `Faire quitter le serveur ${guild.id}`);
		await guild.leave();
		return { left: true, id: guild.id };
	}),
];
