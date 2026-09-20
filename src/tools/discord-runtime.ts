import type { Client, Guild, GuildMember, Role } from "discord.js";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ApprovalManager } from "../discord/approval";
import type { ConversationContext } from "../domain/types";

export interface DiscordToolRuntime {
	client?: Client;
	approvals?: ApprovalManager;
}

export const discordRuntime: DiscordToolRuntime = {};
export const discordContextStorage = new AsyncLocalStorage<ConversationContext>();

export function getToolContext(context?: ConversationContext): ConversationContext | undefined {
	return context ?? discordContextStorage.getStore();
}

export function requireClient(): Client {
	if (!discordRuntime.client) throw new Error("Le client Discord n'est pas prêt.");
	return discordRuntime.client;
}

export function requireGuild(context?: ConversationContext, guildId?: string): Guild {
	const client = requireClient();
	context = getToolContext(context);
	const id = guildId ?? context?.guildId;
	if (!id) throw new Error("Cette action nécessite un serveur Discord.");
	const resolvedId = id === "current" ? context?.guildId : id;
	if (!resolvedId) throw new Error("Aucun serveur Discord courant n'est disponible.");
	if (context?.guildId && context.guildId !== resolvedId)
		throw new Error("Serveur Discord hors du secteur courant.");
	const guild = client.guilds.cache.get(resolvedId);
	if (!guild) throw new Error("Serveur Discord hors périmètre ou inaccessible.");
	return guild;
}

export function requireChannel(guild: Guild, channelId: string) {
	const resolvedId = channelId === "current" ? getToolContext()?.channelId : channelId;
	if (!resolvedId) throw new Error("Aucun salon Discord courant n'est disponible.");
	const channel = guild.channels.cache.get(resolvedId);
	if (!channel?.isTextBased()) throw new Error("Salon textuel introuvable ou hors périmètre.");
	return channel;
}

export async function requireMember(guild: Guild, userId: string): Promise<GuildMember> {
	return guild.members.fetch(userId);
}

export function serializeRole(role: Role) {
	return {
		id: role.id,
		name: role.name,
		color: role.hexColor,
		position: role.position,
		managed: role.managed,
	};
}

export async function approve(
	action: string,
	targetIds: readonly string[],
	token: string | undefined,
	description: string,
): Promise<void> {
	if (!discordRuntime.approvals)
		throw new Error("Le gestionnaire d'approbation n'est pas configuré.");
	if (token) {
		discordRuntime.approvals.consume(token, action, targetIds);
		return;
	}
	const result = await discordRuntime.approvals.request(description, [{ action, targetIds }]);
	if (!result.approved || !result.token) throw new Error("Action refusée ou approbation expirée.");
	discordRuntime.approvals.consume(result.token, action, targetIds);
}

export function ensureInContext(context: ConversationContext | undefined, guildId: string): void {
	if (context?.guildId && context.guildId !== guildId)
		throw new Error("Ressource hors du serveur courant.");
}

export function ensureChannelInContext(
	context: ConversationContext | undefined,
	channelId: string,
): void {
	if (context?.channelId && context.channelId !== channelId && context.guildId === undefined) {
		throw new Error("Ressource hors du contexte courant.");
	}
}
