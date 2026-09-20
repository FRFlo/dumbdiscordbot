import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import {
	cancelTask,
	createCronJob,
	listCronJobs,
	listTasks,
	scheduleMessage,
	setCronStatus,
} from "../ecosystem/scheduler";
import { getToolContext, requireChannel, requireGuild } from "./discord-runtime";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const id = z.string().min(1);

const currentTime = toolDefinition({
	name: "get_current_time",
	description: "Retourne l'heure actuelle dans un fuseau horaire IANA.",
	inputSchema: z.object({ timezone: z.string().default("UTC") }),
	outputSchema: anyResult,
});
const scheduleMessageTool = toolDefinition({
	name: "schedule_discord_message",
	description: "Planifie un message Discord à une date et une heure précises.",
	inputSchema: z.object({
		channelId: id,
		content: z.string().min(1).max(2_000),
		scheduledAt: z.string().datetime({ offset: true }),
	}),
	outputSchema: anyResult,
});
const listTasksTool = toolDefinition({
	name: "list_scheduled_tasks",
	description: "Liste les tâches persistantes planifiées par l'écosystème.",
	inputSchema: z.object({
		status: z.enum(["pending", "completed", "failed", "cancelled", "all"]).default("all"),
	}),
	outputSchema: anyResult,
});
const cancelTaskTool = toolDefinition({
	name: "cancel_scheduled_task",
	description: "Annule une tâche planifiée avant son exécution.",
	inputSchema: z.object({ taskId: id }),
	outputSchema: anyResult,
});
const createCronTool = toolDefinition({
	name: "create_cron_job",
	description: "Crée un cron persistant pour envoyer régulièrement un message Discord.",
	inputSchema: z.object({
		name: z.string().min(1).max(100),
		expression: z.string().regex(/^\S+(?:\s+\S+){4}$/),
		timezone: z.string().default("UTC"),
		actionType: z.enum(["send_message", "invoke_agent", "execute_script"]).default("send_message"),
		channelId: id,
		content: z.string().max(2_000).default(""),
		prompt: z.string().max(8_000).optional(),
		script: z.string().max(20_000).optional(),
		maxAgentCalls: z.number().int().min(0).max(3).default(0),
		delaySeconds: z.number().int().min(0).max(2_592_000).default(0),
	}),
	outputSchema: anyResult,
});
const listCronTool = toolDefinition({
	name: "list_cron_jobs",
	description: "Liste les crons persistants et leur état.",
	inputSchema: z.object({}),
	outputSchema: anyResult,
});
const updateCronTool = toolDefinition({
	name: "update_cron_job_status",
	description: "Active, met en pause ou supprime un cron persistant.",
	inputSchema: z.object({ id, status: z.enum(["active", "paused", "deleted"]) }),
	outputSchema: anyResult,
});

export default [
	currentTime.server(async ({ timezone }) => {
		const now = new Date();
		const formatted = new Intl.DateTimeFormat("fr-FR", {
			timeZone: timezone,
			dateStyle: "full",
			timeStyle: "long",
		}).format(now);
		return { iso: now.toISOString(), timezone, formatted };
	}),
	scheduleMessageTool.server(async ({ channelId, content, scheduledAt }, execution: Exec) => {
		const context = getToolContext(execution.context);
		const guild = requireGuild(context);
		const channel = requireChannel(guild, channelId);
		const runAt = Date.parse(scheduledAt);
		if (runAt <= Date.now()) throw new Error("La date planifiée doit être dans le futur.");
		if (runAt % 60_000 !== 0)
			throw new Error("La planification doit être alignée sur une minute exacte.");
		return {
			scheduled: true,
			...scheduleMessage({ guildId: guild.id, channelId: channel.id, content, runAt }),
			scheduledAt,
		};
	}),
	listTasksTool.server(async ({ status }) => ({ tasks: listTasks(status ?? "all") })),
	cancelTaskTool.server(async ({ taskId }) => ({ cancelled: cancelTask(taskId), taskId })),
	createCronTool.server(
		async (
			{
				name,
				expression,
				timezone,
				actionType,
				channelId,
				content,
				prompt,
				script,
				maxAgentCalls,
				delaySeconds,
			},
			execution: Exec,
		) => {
			if (actionType === "invoke_agent" && !prompt)
				throw new Error("Le prompt est requis pour invoquer l'agent.");
			if (actionType === "execute_script" && !script)
				throw new Error("Le script est requis pour exécuter un script.");
			if (actionType === "send_message" && !content)
				throw new Error("Le contenu est requis pour envoyer un message.");
			const context = getToolContext(execution.context);
			const guild = requireGuild(context);
			const channel = requireChannel(guild, channelId);
			const cronId = createCronJob({
				name,
				expression,
				timezone: timezone ?? "UTC",
				actionType: actionType ?? "send_message",
				guildId: guild.id,
				channelId: channel.id,
				content: content ?? "",
				prompt,
				script,
				maxAgentCalls: maxAgentCalls ?? 0,
				delaySeconds: delaySeconds ?? 0,
			});
			return {
				created: true,
				id: cronId,
				expression,
				timezone: timezone ?? "UTC",
				actionType: actionType ?? "send_message",
				delaySeconds: delaySeconds ?? 0,
			};
		},
	),
	listCronTool.server(async () => ({ jobs: listCronJobs() })),
	updateCronTool.server(async ({ id: cronId, status }) => ({
		updated: setCronStatus(cronId, status),
		id: cronId,
		status,
	})),
];
