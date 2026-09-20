import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ApprovalManager } from "../discord/approval";

const definition = toolDefinition({
  name: "approval",
  description: "Demande une approbation Discord groupée et retourne un jeton limité à une action et à des cibles précises.",
  inputSchema: z.object({
    description: z.string().min(1).max(1_000),
    action: z.string().min(1).max(100),
    targetIds: z.array(z.string().min(1)).min(1).max(1_000),
    timeoutMs: z.number().int().positive().max(120_000).optional(),
  }),
  outputSchema: z.object({ approved: z.boolean(), token: z.string().optional() }),
});

/** Tool séparé pour conserver l'instance du manager hors de l'isolate. */
export function createApprovalTool(manager: ApprovalManager) {
  return definition.server(async ({ description, action, targetIds, timeoutMs }) => manager.request(description, action, targetIds, timeoutMs));
}
