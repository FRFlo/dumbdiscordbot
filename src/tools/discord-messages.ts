import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { approve, ensureChannelInContext, requireChannel, requireGuild } from "./discord-runtime";
import { messageSummary } from "./discord-helpers";
import { parseDiscordDestination, resolveDiscordDestination } from "../discord/destination";

type Exec = { context?: ConversationContext };
const messageInput = z.object({
	channelId: z.string(),
	messageId: z.string(),
	approvalToken: z.string().optional(),
});
const output = z.object({
	id: z.string(),
	channelId: z.string(),
	guildId: z.string().nullable(),
	author: z.object({ id: z.string(), username: z.string(), bot: z.boolean() }).nullable(),
	content: z.string(),
	createdAt: z.string(),
	url: z.string(),
	attachments: z.array(
		z.object({ id: z.string(), name: z.string().nullable(), url: z.string(), size: z.number() }),
	),
});

const get = toolDefinition({
	name: "get_message",
	description: "Récupère un message Discord précis.",
	inputSchema: messageInput,
	outputSchema: output,
});
const list = toolDefinition({
	name: "list_messages",
	description: "Liste les messages récents d'un salon Discord.",
	inputSchema: z.object({
		channelId: z.string(),
		limit: z.number().int().min(1).max(100).default(25),
		before: z.string().optional(),
		after: z.string().optional(),
	}),
	outputSchema: z.object({ messages: z.array(output) }),
});
const search = toolDefinition({
	name: "search_messages",
	description: "Recherche des messages dans les salons accessibles du serveur courant.",
	inputSchema: z.object({
		query: z.string().min(1).max(100),
		channelId: z.string().optional(),
		limit: z.number().int().min(1).max(50).default(25),
	}),
	outputSchema: z.object({ messages: z.array(output) }),
});
const send = toolDefinition({
	name: "send_message",
	description:
		"Envoie un message vers une destination Discord. channelId accepte current, un identifiant historique, discord:channel:<id>, discord:channel:<id>:thread:<threadId>, discord:dm:<userId> ou discord:group:<id>.",
	inputSchema: z.object({ channelId: z.string(), content: z.string().min(1).max(2_000) }),
	outputSchema: output,
});
const reply = toolDefinition({
	name: "reply_to_message",
	description: "Répond à un message Discord après approbation.",
	inputSchema: z.object({
		channelId: z.string(),
		messageId: z.string(),
		content: z.string().min(1).max(2_000),
	}),
	outputSchema: output,
});
const edit = toolDefinition({
	name: "edit_message",
	description: "Modifie un message envoyé par le bot après approbation.",
	inputSchema: z.object({
		channelId: z.string(),
		messageId: z.string(),
		content: z.string().min(1).max(2_000),
	}),
	outputSchema: output,
});
const remove = toolDefinition({
	name: "delete_message",
	description: "Supprime un message après approbation.",
	inputSchema: messageInput,
	outputSchema: z.object({ deleted: z.boolean(), id: z.string() }),
});
const pin = toolDefinition({
	name: "pin_message",
	description: "Épingle ou désépingle un message après approbation.",
	inputSchema: messageInput.extend({ pinned: z.boolean() }),
	outputSchema: z.object({ id: z.string(), pinned: z.boolean() }),
});
const bulkDelete = toolDefinition({
	name: "bulk_delete_messages",
	description: "Supprime plusieurs messages récents après approbation groupée.",
	inputSchema: z.object({
		channelId: z.string(),
		messageIds: z.array(z.string()).min(2).max(100),
		approvalToken: z.string().optional(),
	}),
	outputSchema: z.object({ deleted: z.number() }),
});

async function fetchMessage(
	channelId: string,
	context: ConversationContext | undefined,
	guildId?: string,
) {
	const guild = requireGuild(context, guildId);
	ensureChannelInContext(context, channelId);
	const channel = requireChannel(guild, channelId);
	if (!("messages" in channel)) throw new Error("Ce salon ne permet pas la lecture des messages.");
	return channel.messages;
}

export default [
	get.server(async ({ channelId, messageId }, execution: Exec) => {
		const messages = await fetchMessage(channelId, execution.context);
		return messageSummary(await messages.fetch(messageId));
	}),
	list.server(async ({ channelId, limit, before, after }, execution: Exec) => {
		const guild = requireGuild(execution.context);
		const channel = requireChannel(guild, channelId);
		if (!("messages" in channel)) throw new Error("Salon non textuel.");
		const messages = await channel.messages.fetch({ limit: limit ?? 25, before, after });
		return { messages: [...messages.values()].map(messageSummary) };
	}),
	search.server(async ({ query, channelId, limit }, execution: Exec) => {
		const guild = requireGuild(execution.context);
		const max = limit ?? 25;
		const candidates = channelId
			? [requireChannel(guild, channelId)]
			: [...guild.channels.cache.values()].filter((channel) => channel.isTextBased());
		const result = [];
		for (const channel of candidates) {
			if (!("messages" in channel)) continue;
			const messages = await channel.messages.fetch({ limit: Math.min(max, 100) });
			result.push(
				...[...messages.values()]
					.filter((message) => message.content.toLowerCase().includes(query.toLowerCase()))
					.map(messageSummary),
			);
			if (result.length >= max) break;
		}
		return { messages: result.slice(0, max) };
	}),
	send.server(async ({ channelId, content }, execution: Exec) => {
		const destination = parseDiscordDestination(channelId, execution.context);
		const channel = await resolveDiscordDestination(destination, execution.context);
		return messageSummary(await channel.send({ content }));
	}),
	reply.server(async ({ channelId, messageId, content }, execution: Exec) => {
		const destination = parseDiscordDestination(channelId, execution.context);
		const channel = await resolveDiscordDestination(destination, execution.context);
		if (!("messages" in channel))
			throw new Error("La destination ne permet pas de répondre à un message.");
		const messages = channel.messages;
		return messageSummary(
			await messages.fetch(messageId).then((message) => message.reply({ content })),
		);
	}),
	edit.server(async ({ channelId, messageId, content }, execution: Exec) => {
		const messages = await fetchMessage(channelId, execution.context);
		return messageSummary(
			await messages.fetch(messageId).then((message) => message.edit({ content })),
		);
	}),
	remove.server(async ({ channelId, messageId, approvalToken }, execution: Exec) => {
		await approve(
			"delete_message",
			[messageId],
			approvalToken,
			`Supprimer le message ${messageId}`,
		);
		const messages = await fetchMessage(channelId, execution.context);
		const message = await messages.fetch(messageId);
		await message.delete();
		return { deleted: true, id: messageId };
	}),
	pin.server(async ({ channelId, messageId, pinned }, execution: Exec) => {
		const messages = await fetchMessage(channelId, execution.context);
		const message = await messages.fetch(messageId);
		if (pinned) await message.pin();
		else await message.unpin();
		return { id: messageId, pinned };
	}),
	bulkDelete.server(async ({ channelId, messageIds, approvalToken }, execution: Exec) => {
		await approve(
			"bulk_delete_messages",
			messageIds,
			approvalToken,
			`Supprimer ${messageIds.length} messages dans ${channelId}`,
		);
		const guild = requireGuild(execution.context);
		const channel = requireChannel(guild, channelId);
		if (!("bulkDelete" in channel))
			throw new Error("Salon incompatible avec la suppression groupée.");
		const deleted = await channel.bulkDelete(messageIds, true);
		return { deleted: deleted.size };
	}),
];
