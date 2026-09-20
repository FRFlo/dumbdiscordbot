import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { approve, requireGuild } from "./discord-runtime";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const id = z.string().min(1);

const listBans = toolDefinition({
	name: "list_bans",
	description: "Liste les bannissements d'un serveur Discord.",
	inputSchema: z.object({
		guildId: id.optional(),
		limit: z.number().int().min(1).max(1_000).default(100),
	}),
	outputSchema: anyResult,
});
const bulkTimeout = toolDefinition({
	name: "bulk_timeout_members",
	description: "Place plusieurs membres en timeout après approbation groupée.",
	inputSchema: z.object({
		userIds: z.array(id).min(1).max(100),
		durationMinutes: z.number().int().min(1).max(40_320),
		reason: z.string().max(500).optional(),
		guildId: id.optional(),
		approvalToken: z.string().optional(),
	}),
	outputSchema: anyResult,
});
const prune = toolDefinition({
	name: "prune_members",
	description: "Prune les membres inactifs d'un serveur après approbation.",
	inputSchema: z.object({
		days: z.number().int().min(1).max(30),
		computePruneCount: z.boolean().default(true),
		guildId: id.optional(),
		approvalToken: z.string().optional(),
	}),
	outputSchema: anyResult,
});

export default [
	listBans.server(async ({ guildId, limit }, execution: Exec) => {
		const bans = await requireGuild(execution.context, guildId).bans.fetch({ limit });
		return {
			bans: [...bans.values()].map((ban: any) => ({
				userId: ban.user.id,
				username: ban.user.username,
				reason: ban.reason,
			})),
		};
	}),
	bulkTimeout.server(
		async ({ userIds, durationMinutes, reason, guildId, approvalToken }, execution: Exec) => {
			await approve(
				"bulk_timeout_members",
				userIds,
				approvalToken,
				`Mettre ${userIds.length} membres en timeout`,
			);
			const guild = requireGuild(execution.context, guildId);
			const results = await Promise.allSettled(
				userIds.map(async (userId) => {
					const member = await guild.members.fetch(userId);
					await member.timeout(durationMinutes * 60_000, reason);
					return userId;
				}),
			);
			return {
				succeeded: results
					.filter((result) => result.status === "fulfilled")
					.map((result) => result.value),
				failed: results.filter((result) => result.status === "rejected").length,
			};
		},
	),
	prune.server(async ({ days, computePruneCount, guildId, approvalToken }, execution: Exec) => {
		const guild = requireGuild(execution.context, guildId);
		await approve(
			"prune_members",
			[guild.id],
			approvalToken,
			`Pruner les membres inactifs depuis ${days} jours`,
		);
		return { pruned: await guild.members.prune({ days, count: computePruneCount }) };
	}),
];
