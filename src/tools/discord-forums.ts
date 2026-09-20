import { ChannelType } from "discord.js";
import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { requireChannel, requireGuild } from "./discord-runtime";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const id = z.string().min(1);

const forumPost = toolDefinition({
	name: "create_forum_post",
	description: "Crée un post dans un forum Discord.",
	inputSchema: z.object({
		channelId: id,
		name: z.string().min(1).max(100),
		content: z.string().min(1).max(2_000),
		appliedTags: z.array(id).max(5).default([]),
	}),
	outputSchema: anyResult,
});
const forumTags = toolDefinition({
	name: "list_forum_tags",
	description: "Liste les tags disponibles d'un forum Discord.",
	inputSchema: z.object({ channelId: id }),
	outputSchema: anyResult,
});
export default [
	forumPost.server(async ({ channelId, name, content, appliedTags }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId) as any;
		if (channel.type !== ChannelType.GuildForum) throw new Error("Le salon n'est pas un forum.");
		const thread = await channel.threads.create({ name, appliedTags, message: { content } });
		return { id: thread.id, name: thread.name, parentId: thread.parentId };
	}),
	forumTags.server(async ({ channelId }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId) as any;
		if (channel.type !== ChannelType.GuildForum) throw new Error("Le salon n'est pas un forum.");
		return {
			tags: channel.availableTags.map((tag: any) => ({
				id: tag.id,
				name: tag.name,
				moderated: tag.moderated,
			})),
		};
	}),
];
