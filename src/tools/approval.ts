import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ApprovalAction, QuestionManager } from "../discord/question";

const definition = toolDefinition({
	name: "approval",
	description:
		"Demande une approbation Discord fermée et retourne un jeton limité aux actions et cibles approuvées.",
	inputSchema: z.union([
		z.object({
			description: z.string().min(1).max(1_000),
			actions: z
				.array(
					z.object({
						action: z.string().min(1).max(100),
						targetIds: z.array(z.string().min(1)).min(1).max(1_000),
					}),
				)
				.min(1)
				.max(100),
			timeoutMs: z.number().int().positive().max(120_000).optional(),
		}),
		z.object({
			description: z.string().min(1).max(1_000),
			action: z.string().min(1).max(100),
			targetIds: z.array(z.string().min(1)).min(1).max(1_000),
			timeoutMs: z.number().int().positive().max(120_000).optional(),
		}),
	]),
	outputSchema: z.object({ approved: z.boolean(), token: z.string().optional() }),
});

/** Tool d'approbation explicite ; le contrôle serveur reste obligatoire. */
export function createApprovalTool(manager: QuestionManager) {
	return definition.server(async (input) => {
		const actions: ApprovalAction[] =
			"actions" in input ? input.actions : [{ action: input.action, targetIds: input.targetIds }];
		return manager.requestApproval(input.description, actions, input.timeoutMs);
	});
}
