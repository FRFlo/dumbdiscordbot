import type { AnyThreadChannel, Channel, Guild, GuildMember, Message, Role } from "discord.js";
import type { CodeModeTool } from "@tanstack/ai-code-mode";

export type ToolRisk = "low" | "medium" | "high";
export interface ToolMetadata {
	category: string;
	tags: readonly string[];
	risk: ToolRisk;
	permissions: readonly string[];
	requiresApproval: boolean;
}

export function metadata<T extends CodeModeTool>(tool: T, value: ToolMetadata): T {
	Object.defineProperty(tool, "metadata", { value, enumerable: false });
	return tool;
}

export function messageSummary(message: Message) {
	return {
		id: message.id,
		channelId: message.channelId,
		guildId: message.guildId,
		author: message.author
			? { id: message.author.id, username: message.author.username, bot: message.author.bot }
			: null,
		content: message.content.slice(0, 4_000),
		createdAt: message.createdAt.toISOString(),
		url: message.url,
		attachments: [...message.attachments.values()].map((file) => ({
			id: file.id,
			name: file.name,
			url: file.url,
			size: file.size,
		})),
	};
}

export function channelSummary(channel: Channel) {
	return {
		id: channel.id,
		name: "name" in channel ? channel.name : null,
		type: channel.type,
		parentId: "parentId" in channel ? channel.parentId : null,
	};
}

export function memberSummary(member: GuildMember) {
	return {
		id: member.id,
		username: member.user.username,
		displayName: member.displayName,
		bot: member.user.bot,
		roles: [...member.roles.cache.values()]
			.filter((role) => role.id !== member.guild.id)
			.map((role) => ({ id: role.id, name: role.name })),
	};
}

export function guildSummary(guild: Guild) {
	return {
		id: guild.id,
		name: guild.name,
		ownerId: guild.ownerId,
		memberCount: guild.memberCount,
		description: guild.description,
	};
}

export function roleSummary(role: Role) {
	return {
		id: role.id,
		name: role.name,
		color: role.hexColor,
		position: role.position,
		managed: role.managed,
		permissions: role.permissions.toArray(),
	};
}

export function threadSummary(thread: AnyThreadChannel) {
	return {
		id: thread.id,
		name: thread.name,
		parentId: thread.parentId,
		archived: thread.archived,
		locked: thread.locked,
	};
}
