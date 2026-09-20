import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { approve, requireChannel, requireClient, requireGuild } from "./discord-runtime";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const id = z.string().min(1);

const createInvite = toolDefinition({
	name: "create_invite",
	description: "Crée une invitation pour un salon Discord.",
	inputSchema: z.object({
		channelId: id,
		maxAge: z.number().int().min(0).max(604_800).default(86_400),
		maxUses: z.number().int().min(0).max(100).default(0),
		temporary: z.boolean().default(false),
	}),
	outputSchema: anyResult,
});
const listInvites = toolDefinition({
	name: "list_invites",
	description: "Liste les invitations d'un serveur ou d'un salon Discord.",
	inputSchema: z.object({ guildId: id.optional(), channelId: id.optional() }),
	outputSchema: anyResult,
});
const deleteInvite = toolDefinition({
	name: "delete_invite",
	description: "Supprime une invitation Discord après approbation.",
	inputSchema: z.object({ code: id, approvalToken: z.string().optional() }),
	outputSchema: anyResult,
});
export default [
	createInvite.server(async ({ channelId, maxAge, maxUses, temporary }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId) as any;
		const invite = await channel.createInvite({ maxAge, maxUses, temporary });
		return {
			code: invite.code,
			url: invite.url,
			expiresAt: invite.expiresAt?.toISOString() ?? null,
			maxUses: invite.maxUses,
		};
	}),
	listInvites.server(async ({ guildId, channelId }, execution: Exec) => {
		const guild = requireGuild(execution.context, guildId);
		const invites = channelId
			? await (requireChannel(guild, channelId) as any).fetchInvites()
			: await guild.invites.fetch();
		return {
			invites: [...invites.values()].map((invite: any) => ({
				code: invite.code,
				url: invite.url,
				channelId: invite.channelId,
				inviterId: invite.inviterId,
				uses: invite.uses,
				maxUses: invite.maxUses,
				expiresAt: invite.expiresAt?.toISOString() ?? null,
			})),
		};
	}),
	deleteInvite.server(async ({ code, approvalToken }) => {
		await approve("delete_invite", [code], approvalToken, `Supprimer l'invitation ${code}`);
		const invite = await requireClient().fetchInvite(code);
		await invite.delete();
		return { deleted: true, code };
	}),
];
