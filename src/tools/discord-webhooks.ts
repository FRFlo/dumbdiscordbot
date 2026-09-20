import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { approve, requireChannel, requireClient, requireGuild } from "./discord-runtime";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const id = z.string().min(1);

const listWebhooks = toolDefinition({
	name: "list_webhooks",
	description: "Liste les webhooks d'un salon sans exposer leurs tokens.",
	inputSchema: z.object({ channelId: id }),
	outputSchema: anyResult,
});
const editWebhook = toolDefinition({
	name: "edit_webhook",
	description: "Modifie un webhook Discord.",
	inputSchema: z.object({
		webhookId: id,
		name: z.string().min(1).max(80).optional(),
		channelId: id.optional(),
	}),
	outputSchema: anyResult,
});
const deleteWebhook = toolDefinition({
	name: "delete_webhook",
	description: "Supprime un webhook Discord après approbation.",
	inputSchema: z.object({ webhookId: id, approvalToken: z.string().optional() }),
	outputSchema: anyResult,
});
export default [
	listWebhooks.server(async ({ channelId }, execution: Exec) => {
		const webhooks = await (
			requireChannel(requireGuild(execution.context), channelId) as any
		).fetchWebhooks();
		return {
			webhooks: [...webhooks.values()].map((webhook: any) => ({
				id: webhook.id,
				name: webhook.name,
				channelId: webhook.channelId,
				ownerId: webhook.owner?.id ?? null,
				tokenAvailable: Boolean(webhook.token),
			})),
		};
	}),
	editWebhook.server(async ({ webhookId, name, channelId }) => {
		const webhook = await requireClient().fetchWebhook(webhookId);
		return { id: webhook.id, name: (await webhook.edit({ name, channel: channelId })).name };
	}),
	deleteWebhook.server(async ({ webhookId, approvalToken }) => {
		await approve(
			"delete_webhook",
			[webhookId],
			approvalToken,
			`Supprimer le webhook ${webhookId}`,
		);
		const webhook = await requireClient().fetchWebhook(webhookId);
		await webhook.delete();
		return { deleted: true, id: webhookId };
	}),
];
