import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { approve, requireGuild } from "./discord-runtime";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const id = z.string().min(1);

const listEmojis = toolDefinition({
	name: "list_emojis",
	description: "Liste les emojis personnalisés d'un serveur.",
	inputSchema: z.object({ guildId: id.optional() }),
	outputSchema: anyResult,
});
const deleteEmoji = toolDefinition({
	name: "delete_emoji",
	description: "Supprime un emoji personnalisé après approbation.",
	inputSchema: z.object({
		emojiId: id,
		guildId: id.optional(),
		approvalToken: z.string().optional(),
	}),
	outputSchema: anyResult,
});
const listStickers = toolDefinition({
	name: "list_stickers",
	description: "Liste les stickers personnalisés d'un serveur.",
	inputSchema: z.object({ guildId: id.optional() }),
	outputSchema: anyResult,
});
const deleteSticker = toolDefinition({
	name: "delete_sticker",
	description: "Supprime un sticker personnalisé après approbation.",
	inputSchema: z.object({
		stickerId: id,
		guildId: id.optional(),
		approvalToken: z.string().optional(),
	}),
	outputSchema: anyResult,
});

export default [
	listEmojis.server(async ({ guildId }, execution: Exec) => ({
		emojis: [...(await requireGuild(execution.context, guildId).emojis.fetch()).values()].map(
			(emoji: any) => ({
				id: emoji.id,
				name: emoji.name,
				animated: emoji.animated,
				url: emoji.url,
			}),
		),
	})),
	deleteEmoji.server(async ({ emojiId, guildId, approvalToken }, execution: Exec) => {
		await approve("delete_emoji", [emojiId], approvalToken, `Supprimer l'emoji ${emojiId}`);
		await requireGuild(execution.context, guildId).emojis.delete(emojiId, "Suppression via agent");
		return { deleted: true, id: emojiId };
	}),
	listStickers.server(async ({ guildId }, execution: Exec) => ({
		stickers: [...(await requireGuild(execution.context, guildId).stickers.fetch()).values()].map(
			(sticker: any) => ({
				id: sticker.id,
				name: sticker.name,
				description: sticker.description,
				url: sticker.url,
			}),
		),
	})),
	deleteSticker.server(async ({ stickerId, guildId, approvalToken }, execution: Exec) => {
		await approve(
			"delete_sticker",
			[stickerId],
			approvalToken,
			`Supprimer le sticker ${stickerId}`,
		);
		await requireGuild(execution.context, guildId).stickers.delete(
			stickerId,
			"Suppression via agent",
		);
		return { deleted: true, id: stickerId };
	}),
];
