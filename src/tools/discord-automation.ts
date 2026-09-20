import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { cancelTask, scheduleMessage } from "../ecosystem/scheduler";
import { parseDiscordDestination, resolveDiscordDestination } from "../discord/destination";

type Exec = { context?: ConversationContext };
const schedule = toolDefinition({
	name: "schedule_action",
	description: "Programme un rappel interne du bot après approbation.",
	inputSchema: z.object({
		delaySeconds: z.number().int().min(1).max(86_400),
		channelId: z.string(),
		content: z.string().min(1).max(2_000),
	}),
	outputSchema: z.object({ scheduled: z.boolean(), id: z.string() }),
});
const cancel = toolDefinition({
	name: "cancel_scheduled_action",
	description: "Annule un rappel programmé après approbation.",
	inputSchema: z.object({ id: z.string() }),
	outputSchema: z.object({ cancelled: z.boolean(), id: z.string() }),
});
const preview = toolDefinition({
	name: "preview_bulk_action",
	description: "Prévisualise une action groupée sans l'exécuter.",
	inputSchema: z.object({ action: z.string(), targets: z.array(z.string()).min(1).max(100) }),
	outputSchema: z.object({ count: z.number(), action: z.string(), targets: z.array(z.string()) }),
});

export default [
	schedule.server(async ({ delaySeconds, channelId, content }, execution: Exec) => {
		const destination = parseDiscordDestination(channelId, execution.context);
		const channel = await resolveDiscordDestination(destination, execution.context);
		const task = scheduleMessage({
			guildId: "guildId" in channel ? channel.guildId : undefined,
			channelId: channel.id,
			content,
			runAt: Date.now() + delaySeconds * 1_000,
		});
		return { scheduled: true, id: task.id };
	}),
	cancel.server(async ({ id }) => {
		return { cancelled: cancelTask(id), id };
	}),
	preview.server(async ({ action, targets }) => ({ count: targets.length, action, targets })),
];
