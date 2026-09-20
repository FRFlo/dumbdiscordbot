import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { approve, requireGuild } from "./discord-runtime";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const id = z.string().min(1);

const autoMod = toolDefinition({
	name: "list_auto_moderation_rules",
	description: "Liste les règles AutoMod d'un serveur Discord.",
	inputSchema: z.object({ guildId: id.optional() }),
	outputSchema: anyResult,
});
const deleteAutoMod = toolDefinition({
	name: "delete_auto_moderation_rule",
	description: "Supprime une règle AutoMod après approbation.",
	inputSchema: z.object({
		ruleId: id,
		guildId: id.optional(),
		approvalToken: z.string().optional(),
	}),
	outputSchema: anyResult,
});
export default [
	autoMod.server(async ({ guildId }, execution: Exec) => {
		const rules = await (
			requireGuild(execution.context, guildId) as any
		).autoModerationRules.fetch();
		return {
			rules: [...rules.values()].map((rule: any) => ({
				id: rule.id,
				name: rule.name,
				enabled: rule.enabled,
				eventType: rule.eventType,
				triggerType: rule.triggerType,
			})),
		};
	}),
	deleteAutoMod.server(async ({ ruleId, guildId, approvalToken }, execution: Exec) => {
		await approve(
			"delete_auto_moderation_rule",
			[ruleId],
			approvalToken,
			`Supprimer la règle AutoMod ${ruleId}`,
		);
		await (requireGuild(execution.context, guildId) as any).autoModerationRules.delete(ruleId);
		return { deleted: true, id: ruleId };
	}),
];
