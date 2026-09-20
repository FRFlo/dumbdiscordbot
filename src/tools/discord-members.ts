import type { GuildMember } from "discord.js";
import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { requireGuild, requireMember } from "./discord-runtime";
import { memberSummary } from "./discord-helpers";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const id = z.string().min(1);

const listMembers = toolDefinition({
	name: "list_members",
	description: "Liste les membres accessibles d'un serveur avec pagination simple.",
	inputSchema: z.object({
		guildId: id.optional(),
		limit: z.number().int().min(1).max(1_000).default(100),
	}),
	outputSchema: anyResult,
});
const userProfile = toolDefinition({
	name: "get_user_profile",
	description: "Retourne le profil détaillé d'un utilisateur dans le serveur courant.",
	inputSchema: z.object({ userId: id, guildId: id.optional() }),
	outputSchema: anyResult,
});
function summarizeMember(member: GuildMember) {
	return {
		...memberSummary(member),
		joinedAt: member.joinedAt?.toISOString() ?? null,
		nickname: member.nickname,
	};
}

export default [
	listMembers.server(async ({ guildId, limit }, execution: Exec) => {
		const guild = requireGuild(execution.context, guildId);
		const members = await guild.members.fetch({ limit });
		return { members: [...members.values()].slice(0, limit).map(summarizeMember) };
	}),
	userProfile.server(async ({ userId, guildId }, execution: Exec) =>
		summarizeMember(await requireMember(requireGuild(execution.context, guildId), userId)),
	),
];
