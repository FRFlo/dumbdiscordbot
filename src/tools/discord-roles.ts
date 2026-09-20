import type { GuildMember } from "discord.js";
import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { requireGuild } from "./discord-runtime";
import { memberSummary, roleSummary } from "./discord-helpers";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const id = z.string().min(1);
function summarizeMember(member: GuildMember) {
	return {
		...memberSummary(member),
		joinedAt: member.joinedAt?.toISOString() ?? null,
		nickname: member.nickname,
	};
}

const editRole = toolDefinition({
	name: "edit_role",
	description: "Modifie un rôle Discord.",
	inputSchema: z.object({
		roleId: id,
		name: z.string().min(1).max(100).optional(),
		color: z
			.string()
			.regex(/^#?[0-9a-f]{6}$/i)
			.optional(),
		hoist: z.boolean().optional(),
		mentionable: z.boolean().optional(),
		guildId: id.optional(),
	}),
	outputSchema: anyResult,
});
const moveRole = toolDefinition({
	name: "move_role",
	description: "Déplace un rôle dans la hiérarchie Discord.",
	inputSchema: z.object({
		roleId: id,
		position: z.number().int().min(1).max(250),
		guildId: id.optional(),
	}),
	outputSchema: anyResult,
});
const roleMembers = toolDefinition({
	name: "list_role_members",
	description: "Liste les membres possédant un rôle Discord.",
	inputSchema: z.object({
		roleId: id,
		guildId: id.optional(),
		limit: z.number().int().min(1).max(1_000).default(100),
	}),
	outputSchema: anyResult,
});
export default [
	editRole.server(async ({ roleId, name, color, hoist, mentionable, guildId }, execution: Exec) => {
		const role = await requireGuild(execution.context, guildId).roles.fetch(roleId);
		if (!role) throw new Error("Rôle introuvable.");
		return roleSummary(
			await role.edit({
				name,
				colors: color ? { primaryColor: color as `#${string}` } : undefined,
				hoist,
				mentionable,
			}),
		);
	}),
	moveRole.server(async ({ roleId, position, guildId }, execution: Exec) => {
		const role = await requireGuild(execution.context, guildId).roles.fetch(roleId);
		if (!role) throw new Error("Rôle introuvable.");
		return roleSummary(await role.setPosition(position));
	}),
	roleMembers.server(async ({ roleId, guildId, limit }, execution: Exec) => {
		const guild = requireGuild(execution.context, guildId);
		const members = [...guild.members.cache.values()]
			.filter((member) => member.roles.cache.has(roleId))
			.slice(0, limit);
		return { members: members.map(summarizeMember) };
	}),
];
