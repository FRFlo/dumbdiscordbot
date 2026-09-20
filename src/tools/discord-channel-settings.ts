import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { approve, requireChannel, requireGuild } from "./discord-runtime";
import { channelSummary } from "./discord-helpers";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const id = z.string().min(1);

const channelSettings = toolDefinition({
	name: "get_channel_settings",
	description: "Retourne les paramètres avancés d'un salon Discord.",
	inputSchema: z.object({ channelId: id }),
	outputSchema: anyResult,
});
const editChannelSettings = toolDefinition({
	name: "edit_channel_settings",
	description: "Modifie les paramètres avancés d'un salon Discord.",
	inputSchema: z.object({
		channelId: id,
		topic: z.string().max(1_024).nullable().optional(),
		rateLimitPerUser: z.number().int().min(0).max(21_600).optional(),
		nsfw: z.boolean().optional(),
		bitrate: z.number().int().min(8).max(384).optional(),
		userLimit: z.number().int().min(0).max(99).optional(),
		rtcRegion: z.string().nullable().optional(),
	}),
	outputSchema: anyResult,
});
const listOverwrites = toolDefinition({
	name: "get_channel_overwrites",
	description: "Liste les permissions spécifiques d'un salon Discord.",
	inputSchema: z.object({ channelId: id }),
	outputSchema: anyResult,
});
const setOverwrite = toolDefinition({
	name: "set_channel_overwrite",
	description: "Configure les permissions d'un membre ou rôle dans un salon.",
	inputSchema: z.object({
		channelId: id,
		targetId: id,
		allow: z.array(z.string()).default([]),
		deny: z.array(z.string()).default([]),
	}),
	outputSchema: anyResult,
});
const deleteOverwrite = toolDefinition({
	name: "delete_channel_overwrite",
	description: "Supprime une surcharge de permissions d'un salon.",
	inputSchema: z.object({ channelId: id, targetId: id, approvalToken: z.string().optional() }),
	outputSchema: anyResult,
});
export default [
	channelSettings.server(async ({ channelId }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId) as any;
		return {
			...channelSummary(channel),
			topic: channel.topic ?? null,
			nsfw: channel.nsfw ?? null,
			rateLimitPerUser: channel.rateLimitPerUser ?? null,
			bitrate: channel.bitrate ?? null,
			userLimit: channel.userLimit ?? null,
			rtcRegion: channel.rtcRegion ?? null,
		};
	}),
	editChannelSettings.server(async ({ channelId, ...changes }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId) as any;
		return channelSummary(await channel.edit(changes));
	}),
	listOverwrites.server(async ({ channelId }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId) as any;
		return {
			overwrites: [...(channel.permissionOverwrites?.cache ?? []).values()].map(
				(overwrite: any) => ({
					id: overwrite.id,
					type: overwrite.type,
					allow: overwrite.allow.toArray(),
					deny: overwrite.deny.toArray(),
				}),
			),
		};
	}),
	setOverwrite.server(async ({ channelId, targetId, allow, deny }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId) as any;
		return channel.permissionOverwrites.edit(targetId, { allow, deny });
	}),
	deleteOverwrite.server(async ({ channelId, targetId, approvalToken }, execution: Exec) => {
		await approve(
			"delete_channel_overwrite",
			[targetId],
			approvalToken,
			`Supprimer les permissions ${targetId}`,
		);
		const channel = requireChannel(requireGuild(execution.context), channelId) as any;
		await channel.permissionOverwrites.delete(targetId);
		return { deleted: true, targetId };
	}),
];
