import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { createEventAddon, listEventAddons, setEventAddonStatus } from "../ecosystem/event-addons";
import { getToolContext, requireChannel, requireGuild } from "./discord-runtime";
import type { ConversationContext } from "../domain/types";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const id = z.string().min(1);

const create = toolDefinition({
	name: "create_discord_event_addon",
	description: "Branche une invocation d'agent ou un script sur un événement discord.js.",
	inputSchema: z.object({
		name: z.string().min(1).max(100),
		eventName: z.string().min(1).max(100),
		channelId: id,
		once: z.boolean().default(false),
		actionType: z.enum(["invoke_agent", "execute_script"]),
		prompt: z.string().max(8_000).optional(),
		script: z.string().max(20_000).optional(),
		maxAgentCalls: z.number().int().min(0).max(3).default(0),
	}),
	outputSchema: anyResult,
});
const list = toolDefinition({
	name: "list_discord_event_addons",
	description: "Liste les addons branchés sur les événements Discord.",
	inputSchema: z.object({}),
	outputSchema: anyResult,
});
const update = toolDefinition({
	name: "update_discord_event_addon_status",
	description: "Active, met en pause ou supprime un addon d'événement Discord.",
	inputSchema: z.object({ id, status: z.enum(["active", "paused", "deleted"]) }),
	outputSchema: anyResult,
});

export default [
	create.server(
		async (
			{ name, eventName, channelId, once, actionType, prompt, script, maxAgentCalls },
			execution: Exec,
		) => {
			if (actionType === "invoke_agent" && !prompt)
				throw new Error("Le prompt est requis pour invoquer l'agent.");
			if (actionType === "execute_script" && !script)
				throw new Error("Le script est requis pour exécuter un script.");
			const context = getToolContext(execution.context);
			const guild = requireGuild(context);
			const channel = requireChannel(guild, channelId);
			return {
				created: true,
				id: createEventAddon({
					name,
					eventName,
					guildId: guild.id,
					channelId: channel.id,
					once: once ?? false,
					actionType,
					prompt,
					script,
					maxAgentCalls: maxAgentCalls ?? 0,
				}),
				eventName,
				actionType,
				once: once ?? false,
			};
		},
	),
	list.server(async () => ({ addons: listEventAddons() })),
	update.server(async ({ id: addonId, status }) => ({
		updated: setEventAddonStatus(addonId, status),
		id: addonId,
		status,
	})),
];
