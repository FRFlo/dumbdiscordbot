import { ChannelType } from "discord.js";
import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { approve, requireChannel, requireGuild } from "./discord-runtime";
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

export default [
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
