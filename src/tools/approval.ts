import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ApprovalAction, ApprovalManager } from "../discord/approval";

const definition = toolDefinition({
	name: "approval",
	description:
		"Demande une approbation Discord groupée et retourne un jeton limité à plusieurs actions et à leurs cibles précises.",
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

/** Tool séparé pour conserver l'instance du manager hors de l'isolate. */
export function createApprovalTool(manager: ApprovalManager) {
	return definition.server(async (input) => {
		const actions: ApprovalAction[] =
			"actions" in input ? input.actions : [{ action: input.action, targetIds: input.targetIds }];
		return manager.request(input.description, actions, input.timeoutMs);
	});
}
