import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ApprovalManager } from "../discord/approval";

const definition = toolDefinition({
  name: "approval",
  description: "Attend une approbation Discord de l'auteur de la demande avant de poursuivre.",
  inputSchema: z.object({
    description: z.string().min(1).max(1_000),
    timeoutMs: z.number().int().positive().max(30_000).optional(),
  }),
  outputSchema: z.object({ approved: z.boolean() }),
});

/** Tool séparé pour conserver l'instance du manager hors de l'isolate. */
export function createApprovalTool(manager: ApprovalManager) {
  return definition.server(async ({ description, timeoutMs }) => ({
    approved: await manager.request(description, timeoutMs),
  }));
}
