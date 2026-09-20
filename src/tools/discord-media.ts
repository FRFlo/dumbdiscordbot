import { WebhookClient } from "discord.js";
import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { requireChannel, requireGuild } from "./discord-runtime";

type Exec = { context?: ConversationContext };
const attachment = z.object({
	id: z.string(),
	name: z.string().nullable(),
	url: z.string(),
	size: z.number(),
	contentType: z.string().nullable(),
});
const list = toolDefinition({
	name: "list_message_attachments",
	description: "Liste les pièces jointes d'un message.",
	inputSchema: z.object({ channelId: z.string(), messageId: z.string() }),
	outputSchema: z.object({ attachments: z.array(attachment) }),
});
const get = toolDefinition({
	name: "get_attachment",
	description: "Retourne les métadonnées d'une pièce jointe.",
	inputSchema: z.object({ channelId: z.string(), messageId: z.string(), attachmentId: z.string() }),
	outputSchema: attachment,
});
const downloadMetadata = toolDefinition({
	name: "download_attachment_metadata",
	description: "Retourne l'URL et les métadonnées d'une pièce jointe sans télécharger son contenu.",
	inputSchema: z.object({ channelId: z.string(), messageId: z.string(), attachmentId: z.string() }),
	outputSchema: attachment,
});
const send = toolDefinition({
	name: "send_file",
	description: "Envoie un fichier depuis une URL après approbation.",
	inputSchema: z.object({
		channelId: z.string(),
		url: z.string().url(),
		content: z.string().max(2_000).optional(),
	}),
	outputSchema: z.object({ id: z.string(), url: z.string() }),
});
const createWebhook = toolDefinition({
	name: "create_webhook",
	description: "Crée un webhook dans un salon.",
	inputSchema: z.object({ channelId: z.string(), name: z.string().min(1).max(80) }),
	outputSchema: z.any(),
});
const sendWebhook = toolDefinition({
	name: "send_webhook_message",
	description: "Envoie un message via un webhook existant.",
	inputSchema: z.object({
		webhookId: z.string(),
		webhookToken: z.string(),
		content: z.string().min(1).max(2_000),
	}),
	outputSchema: z.object({ sent: z.boolean() }),
});

async function findAttachment(
	channelId: string,
	messageId: string,
	attachmentId: string,
	execution: Exec,
) {
	const channel = requireChannel(requireGuild(execution.context), channelId);
	if (!("messages" in channel)) throw new Error("Salon non textuel.");
	const file = (await channel.messages.fetch(messageId)).attachments.get(attachmentId);
	if (!file) throw new Error("Pièce jointe introuvable.");
	return {
		id: file.id,
		name: file.name,
		url: file.url,
		size: file.size,
		contentType: file.contentType,
	};
}

export default [
	list.server(async ({ channelId, messageId }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId);
		if (!("messages" in channel)) throw new Error("Salon non textuel.");
		const message = await channel.messages.fetch(messageId);
		return {
			attachments: [...message.attachments.values()].map((file) => ({
				id: file.id,
				name: file.name,
				url: file.url,
				size: file.size,
				contentType: file.contentType,
			})),
		};
	}),
	get.server(async ({ channelId, messageId, attachmentId }, execution: Exec) =>
		findAttachment(channelId, messageId, attachmentId, execution),
	),
	downloadMetadata.server(async ({ channelId, messageId, attachmentId }, execution: Exec) =>
		findAttachment(channelId, messageId, attachmentId, execution),
	),
	send.server(async ({ channelId, url, content }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId);
		if (!("send" in channel)) throw new Error("Salon non textuel.");
		const message = await channel.send({ content, files: [url] });
		return { id: message.id, url: message.url };
	}),
	createWebhook.server(async ({ channelId, name }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId);
		if (!("createWebhook" in channel)) throw new Error("Salon incompatible avec les webhooks.");
		const webhook = await channel.createWebhook({ name });
		return { id: webhook.id, name: webhook.name, token: webhook.token };
	}),
	sendWebhook.server(async ({ webhookId, webhookToken, content }) => {
		const webhook = new WebhookClient({ id: webhookId, token: webhookToken });
		await webhook.send({ content });
		webhook.destroy();
		return { sent: true };
	}),
];
