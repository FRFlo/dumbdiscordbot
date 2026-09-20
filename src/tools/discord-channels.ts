import { ChannelType, type CategoryChannel } from "discord.js";
import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { approve, requireCategory, requireChannel, requireGuild } from "./discord-runtime";
import { channelSummary, threadSummary } from "./discord-helpers";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const create = toolDefinition({
	name: "create_channel",
	description: "Crée un salon Discord après approbation.",
	inputSchema: z.object({
		name: z.string().min(1).max(100),
		type: z.enum(["text", "voice", "category", "announcement"]).default("text"),
		parentId: z.string().optional(),
		topic: z.string().max(1_024).optional(),
	}),
	outputSchema: anyResult,
});
const edit = toolDefinition({
	name: "edit_channel",
	description: "Modifie un salon Discord après approbation.",
	inputSchema: z.object({
		channelId: z.string(),
		name: z.string().min(1).max(100).optional(),
		topic: z.string().max(1_024).nullable().optional(),
		parentId: z.string().nullable().optional(),
	}),
	outputSchema: anyResult,
});
const remove = toolDefinition({
	name: "delete_channel",
	description: "Supprime un salon Discord après approbation.",
	inputSchema: z.object({ channelId: z.string(), approvalToken: z.string().optional() }),
	outputSchema: z.object({ deleted: z.boolean(), id: z.string() }),
});
const move = toolDefinition({
	name: "move_channel",
	description: "Déplace un salon dans une catégorie après approbation.",
	inputSchema: z.object({ channelId: z.string(), parentId: z.string().nullable() }),
	outputSchema: anyResult,
});
const createThread = toolDefinition({
	name: "create_thread",
	description: "Crée un thread dans un salon ou à partir d'un message après approbation.",
	inputSchema: z.object({
		channelId: z.string(),
		name: z.string().min(1).max(100),
		messageId: z.string().optional(),
		autoArchiveDuration: z.enum(["60", "1440", "4320", "10080"]).default("1440"),
	}),
	outputSchema: anyResult,
});
const archive = toolDefinition({
	name: "archive_thread",
	description: "Archive ou désarchive un thread après approbation.",
	inputSchema: z.object({
		channelId: z.string(),
		archived: z.boolean().default(true),
		locked: z.boolean().default(false),
	}),
	outputSchema: anyResult,
});
const lock = toolDefinition({
	name: "lock_channel",
	description: "Verrouille un salon en retirant l'envoi de messages aux membres.",
	inputSchema: z.object({ channelId: z.string() }),
	outputSchema: anyResult,
});
const unlock = toolDefinition({
	name: "unlock_channel",
	description: "Déverrouille un salon.",
	inputSchema: z.object({ channelId: z.string() }),
	outputSchema: anyResult,
});
const listCategories = toolDefinition({
	name: "list_categories",
	description: "Liste les catégories d'un serveur Discord.",
	inputSchema: z.object({ guildId: z.string().optional() }),
	outputSchema: z.array(anyResult),
});
const getCategory = toolDefinition({
	name: "get_category",
	description: "Récupère une catégorie Discord par son identifiant.",
	inputSchema: z.object({ categoryId: z.string(), guildId: z.string().optional() }),
	outputSchema: anyResult,
});
const createCategory = toolDefinition({
	name: "create_category",
	description: "Crée une catégorie Discord.",
	inputSchema: z.object({
		name: z.string().min(1).max(100),
		position: z.number().int().min(0).max(1_000).optional(),
		guildId: z.string().optional(),
	}),
	outputSchema: anyResult,
});
const editCategory = toolDefinition({
	name: "edit_category",
	description: "Modifie le nom ou la position d'une catégorie Discord.",
	inputSchema: z.object({
		categoryId: z.string(),
		name: z.string().min(1).max(100).optional(),
		position: z.number().int().min(0).max(1_000).optional(),
		guildId: z.string().optional(),
	}),
	outputSchema: anyResult,
});
const deleteCategory = toolDefinition({
	name: "delete_category",
	description: "Supprime une catégorie Discord après approbation.",
	inputSchema: z.object({
		categoryId: z.string(),
		guildId: z.string().optional(),
		approvalToken: z.string().optional(),
	}),
	outputSchema: z.object({ deleted: z.boolean(), id: z.string() }),
});
const moveCategory = toolDefinition({
	name: "move_category",
	description: "Déplace une catégorie dans l'ordre des salons Discord.",
	inputSchema: z.object({
		categoryId: z.string(),
		position: z.number().int().min(0).max(1_000),
		guildId: z.string().optional(),
	}),
	outputSchema: anyResult,
});

export default [
	listCategories.server(async ({ guildId }, execution: Exec) => {
		const guild = requireGuild(execution.context, guildId);
		const categories = [...guild.channels.cache.values()].filter(
			(channel): channel is CategoryChannel => channel.type === ChannelType.GuildCategory,
		);
		return categories
			.sort((left, right) => left.position - right.position)
			.map((category) => ({
				...channelSummary(category),
				position: category.position,
				childChannelIds: category.children.cache.map((child) => child.id),
			}));
	}),
	getCategory.server(async ({ categoryId, guildId }, execution: Exec) => {
		const category = requireCategory(requireGuild(execution.context, guildId), categoryId);
		return {
			...channelSummary(category),
			position: category.position,
			childChannelIds: category.children.cache.map((child) => child.id),
		};
	}),
	createCategory.server(async ({ name, position, guildId }, execution: Exec) => {
		const category = await requireGuild(execution.context, guildId).channels.create({
			name,
			type: ChannelType.GuildCategory,
		});
		if (position !== undefined) await category.setPosition(position);
		return {
			...channelSummary(category),
			position: category.position,
			childChannelIds: [],
		};
	}),
	editCategory.server(async ({ categoryId, name, position, guildId }, execution: Exec) => {
		const category = requireCategory(requireGuild(execution.context, guildId), categoryId);
		if (name !== undefined) await category.edit({ name });
		if (position !== undefined) await category.setPosition(position);
		return {
			...channelSummary(category),
			position: category.position,
			childChannelIds: category.children.cache.map((child) => child.id),
		};
	}),
	deleteCategory.server(async ({ categoryId, guildId, approvalToken }, execution: Exec) => {
		const category = requireCategory(requireGuild(execution.context, guildId), categoryId);
		await approve(
			"delete_category",
			[category.id],
			approvalToken,
			`Supprimer la catégorie ${category.id}`,
		);
		await category.delete();
		return { deleted: true, id: category.id };
	}),
	moveCategory.server(async ({ categoryId, position, guildId }, execution: Exec) => {
		const category = requireCategory(requireGuild(execution.context, guildId), categoryId);
		await category.setPosition(position);
		return {
			...channelSummary(category),
			position: category.position,
			childChannelIds: category.children.cache.map((child) => child.id),
		};
	}),
	create.server(async ({ name, type, parentId, topic }, execution: Exec) => {
		const guild = requireGuild(execution.context);
		const channel = await guild.channels.create({
			name,
			type:
				type === "voice"
					? ChannelType.GuildVoice
					: type === "category"
						? ChannelType.GuildCategory
						: type === "announcement"
							? ChannelType.GuildAnnouncement
							: ChannelType.GuildText,
			parent: parentId,
			topic,
		});
		return channelSummary(channel);
	}),
	edit.server(async ({ channelId, name, topic, parentId }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId);
		if (!("edit" in channel)) throw new Error("Salon non modifiable.");
		return channelSummary(await channel.edit({ name, topic, parent: parentId }));
	}),
	remove.server(async ({ channelId, approvalToken }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId);
		await approve(
			"delete_channel",
			[channel.id],
			approvalToken,
			`Supprimer le salon ${channel.id}`,
		);
		await channel.delete();
		return { deleted: true, id: channel.id };
	}),
	move.server(async ({ channelId, parentId }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId);
		if (!("setParent" in channel)) throw new Error("Salon non déplaçable.");
		return channelSummary(await channel.setParent(parentId));
	}),
	createThread.server(
		async ({ channelId, name, messageId, autoArchiveDuration }, execution: Exec) => {
			const channel = requireChannel(requireGuild(execution.context), channelId);
			if (messageId && "messages" in channel) {
				const message = await channel.messages.fetch(messageId);
				return threadSummary(
					await message.startThread({
						name,
						autoArchiveDuration: Number(autoArchiveDuration) as 60 | 1440 | 4320 | 10080,
					}),
				);
			}
			if (!("threads" in channel)) throw new Error("Ce salon ne permet pas les threads.");
			return threadSummary(
				await channel.threads.create({
					name,
					autoArchiveDuration: Number(autoArchiveDuration) as 60 | 1440 | 4320 | 10080,
				}),
			);
		},
	),
	archive.server(async ({ channelId, archived, locked }, execution: Exec) => {
		const channel = requireGuild(execution.context).channels.cache.get(channelId);
		if (!channel?.isThread()) throw new Error("Thread introuvable.");
		return threadSummary(await channel.edit({ archived, locked }));
	}),
	lock.server(async ({ channelId }, execution: Exec) => {
		const guild = requireGuild(execution.context);
		const channel = requireChannel(guild, channelId);
		if (!("permissionOverwrites" in channel))
			throw new Error("Salon incompatible avec le verrouillage.");
		await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
		return channelSummary(channel);
	}),
	unlock.server(async ({ channelId }, execution: Exec) => {
		const guild = requireGuild(execution.context);
		const channel = requireChannel(guild, channelId);
		if (!("permissionOverwrites" in channel))
			throw new Error("Salon incompatible avec le déverrouillage.");
		await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
		return channelSummary(channel);
	}),
];
