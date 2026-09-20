import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { getToolContext, requireChannel, requireGuild, requireMember } from "./discord-runtime";
import { channelSummary, guildSummary, memberSummary, roleSummary } from "./discord-helpers";
import type { ConversationContext } from "../domain/types";

type Exec = { context?: ConversationContext };
const empty = z.object({});

const current = toolDefinition({
	name: "get_current_context",
	description: "Retourne le serveur, salon et utilisateur du message courant.",
	inputSchema: empty,
	outputSchema: z.object({
		guildId: z.string().nullable(),
		channelId: z.string(),
		userId: z.string(),
		userName: z.string(),
	}),
});
const guildInfo = toolDefinition({
	name: "get_guild_info",
	description: "Retourne les informations du serveur Discord courant ou demandé.",
	inputSchema: z.object({ guildId: z.string().optional() }),
	outputSchema: z.object({
		id: z.string(),
		name: z.string(),
		ownerId: z.string().nullable(),
		memberCount: z.number(),
		description: z.string().nullable(),
	}),
});
const channels = toolDefinition({
	name: "list_channels",
	description: "Liste les salons accessibles d'un serveur Discord.",
	inputSchema: z.object({
		guildId: z.string().optional(),
		type: z.enum(["all", "text", "voice", "category", "thread"]).default("all"),
	}),
	outputSchema: z.object({
		channels: z.array(
			z.object({
				id: z.string(),
				name: z.string().nullable(),
				type: z.number(),
				parentId: z.string().nullable(),
			}),
		),
	}),
});
const channelInfo = toolDefinition({
	name: "get_channel_info",
	description: "Retourne les informations d'un salon Discord.",
	inputSchema: z.object({ channelId: z.string() }),
	outputSchema: z.object({
		id: z.string(),
		name: z.string().nullable(),
		type: z.number(),
		parentId: z.string().nullable(),
	}),
});
const member = toolDefinition({
	name: "get_member",
	description: "Retourne le profil d'un membre du serveur.",
	inputSchema: z.object({ userId: z.string(), guildId: z.string().optional() }),
	outputSchema: z.object({
		id: z.string(),
		username: z.string(),
		displayName: z.string(),
		bot: z.boolean(),
		roles: z.array(z.object({ id: z.string(), name: z.string() })),
	}),
});
const searchMembers = toolDefinition({
	name: "search_members",
	description:
		"Recherche des membres par nom ou identifiant. Une recherche vide liste les membres en cache.",
	inputSchema: z.object({
		query: z.string().max(100),
		guildId: z.string().optional(),
		limit: z.number().int().min(1).max(100).default(25),
	}),
	outputSchema: z.object({
		members: z.array(
			z.object({
				id: z.string(),
				username: z.string(),
				displayName: z.string(),
				bot: z.boolean(),
				roles: z.array(z.object({ id: z.string(), name: z.string() })),
			}),
		),
	}),
});
const roles = toolDefinition({
	name: "list_roles",
	description: "Liste les rôles d'un serveur Discord.",
	inputSchema: z.object({ guildId: z.string().optional() }),
	outputSchema: z.object({
		roles: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				color: z.string(),
				position: z.number(),
				managed: z.boolean(),
				permissions: z.array(z.string()),
			}),
		),
	}),
});
const roleInfo = toolDefinition({
	name: "get_role",
	description: "Retourne les informations d'un rôle.",
	inputSchema: z.object({ roleId: z.string(), guildId: z.string().optional() }),
	outputSchema: z.any(),
});
const memberRoles = toolDefinition({
	name: "get_member_roles",
	description: "Retourne les rôles d'un membre.",
	inputSchema: z.object({ userId: z.string(), guildId: z.string().optional() }),
	outputSchema: z.any(),
});
const permissions = toolDefinition({
	name: "get_bot_permissions",
	description: "Retourne les permissions du bot dans un salon.",
	inputSchema: z.object({ channelId: z.string(), guildId: z.string().optional() }),
	outputSchema: z.object({ permissions: z.array(z.string()) }),
});
const memberPermission = toolDefinition({
	name: "check_member_permission",
	description: "Vérifie une permission Discord pour un membre dans un salon.",
	inputSchema: z.object({ userId: z.string(), permission: z.string(), channelId: z.string() }),
	outputSchema: z.object({ allowed: z.boolean(), permission: z.string() }),
});

export default [
	current.server(async (_args, execution: Exec) => {
		const context = getToolContext(execution.context);
		if (!context) throw new Error("Contexte Discord absent.");
		return {
			guildId: context.guildId ?? null,
			channelId: context.channelId,
			userId: context.authorId,
			userName: context.authorName,
		};
	}),
	guildInfo.server(async ({ guildId }, execution: Exec) =>
		guildSummary(requireGuild(execution.context, guildId)),
	),
	channels.server(async ({ guildId, type }, execution: Exec) => {
		const guild = requireGuild(execution.context, guildId);
		const values = [...guild.channels.cache.values()].filter(
			(channel) =>
				type === "all" ||
				(type === "text" && channel.isTextBased()) ||
				(type === "voice" && channel.isVoiceBased()) ||
				(type === "category" && channel.type === 4) ||
				(type === "thread" && channel.isThread()),
		);
		return { channels: values.map(channelSummary) };
	}),
	channelInfo.server(async ({ channelId }, execution: Exec) => {
		const guild = requireGuild(execution.context);
		const channel = requireChannel(guild, channelId);
		return channelSummary(channel);
	}),
	member.server(async ({ userId, guildId }, execution: Exec) =>
		memberSummary(await requireMember(requireGuild(execution.context, guildId), userId)),
	),
	searchMembers.server(async ({ query, guildId, limit }, execution: Exec) => {
		const guild = requireGuild(execution.context, guildId);
		const max = limit ?? 25;
		const found = query.trim()
			? [...(await guild.members.fetch({ query: query.trim(), limit: max })).values()]
			: [...guild.members.cache.values()].slice(0, max);
		return { members: found.map(memberSummary) };
	}),
	roles.server(async ({ guildId }, execution: Exec) => {
		const guild = requireGuild(execution.context, guildId);
		const result = await guild.roles.fetch();
		return { roles: [...result.values()].map(roleSummary) };
	}),
	roleInfo.server(async ({ roleId, guildId }, execution: Exec) => {
		const role = await requireGuild(execution.context, guildId).roles.fetch(roleId);
		if (!role) throw new Error("Rôle introuvable.");
		return roleSummary(role);
	}),
	memberRoles.server(async ({ userId, guildId }, execution: Exec) => {
		const member = await requireMember(requireGuild(execution.context, guildId), userId);
		return {
			roles: [...member.roles.cache.values()]
				.filter((role) => role.id !== member.guild.id)
				.map(roleSummary),
		};
	}),
	permissions.server(async ({ channelId }, execution: Exec) => {
		const guild = requireGuild(execution.context);
		const channel = requireChannel(guild, channelId);
		const me = await guild.members.fetchMe();
		if (!("permissionsFor" in channel))
			throw new Error("Ce salon ne fournit pas de permissions Discord.");
		return { permissions: channel.permissionsFor(me)?.toArray() ?? [] };
	}),
	memberPermission.server(async ({ userId, permission, channelId }, execution: Exec) => {
		const guild = requireGuild(execution.context);
		const channel = requireChannel(guild, channelId);
		if (!("permissionsFor" in channel))
			throw new Error("Ce salon ne fournit pas de permissions Discord.");
		const member = await requireMember(guild, userId);
		return {
			allowed: channel.permissionsFor(member)?.has(permission as never) ?? false,
			permission,
		};
	}),
];
