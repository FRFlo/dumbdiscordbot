import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { approve, requireChannel, requireGuild } from "./discord-runtime";

type Exec = { context?: ConversationContext };
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const schedule = toolDefinition({ name: "schedule_action", description: "Programme un rappel interne du bot après approbation.", inputSchema: z.object({ delaySeconds: z.number().int().min(1).max(86_400), channelId: z.string(), content: z.string().min(1).max(2_000) }), outputSchema: z.object({ scheduled: z.boolean(), id: z.string() }) });
const cancel = toolDefinition({ name: "cancel_scheduled_action", description: "Annule un rappel programmé après approbation.", inputSchema: z.object({ id: z.string() }), outputSchema: z.object({ cancelled: z.boolean(), id: z.string() }) });
const preview = toolDefinition({ name: "preview_bulk_action", description: "Prévisualise une action groupée sans l'exécuter.", inputSchema: z.object({ action: z.string(), targets: z.array(z.string()).min(1).max(100) }), outputSchema: z.object({ count: z.number(), action: z.string(), targets: z.array(z.string()) }) });

export default [
  schedule.server(async ({ delaySeconds, channelId, content }, execution: Exec) => { const id = crypto.randomUUID(); const guild = requireGuild(execution.context); const timer = setTimeout(() => { const channel = requireChannel(guild, channelId); if ("send" in channel) void channel.send({ content }); timers.delete(id); }, delaySeconds * 1_000); timers.set(id, timer); return { scheduled: true, id }; }),
  cancel.server(async ({ id }) => { const timer = timers.get(id); if (timer) { clearTimeout(timer); timers.delete(id); } return { cancelled: Boolean(timer), id }; }),
  preview.server(async ({ action, targets }) => ({ count: targets.length, action, targets })),
];

