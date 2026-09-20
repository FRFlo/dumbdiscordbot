import {
	ChannelType,
	type CategoryChannel,
	type Client,
	type Guild,
	type GuildMember,
	type Role,
} from "discord.js";
import { AsyncLocalStorage } from "node:async_hooks";
import type { QuestionManager } from "../discord/question";
import type { ConversationContext } from "../domain/types";

export interface DiscordToolRuntime {
	client?: Client;
	questions?: QuestionManager;
}

export const DIRECT_RESPONSE_PREFIX = "[DIRECT_RESPONSE]\n";

export function formatDirectResponse(content: string): string {
	return `${DIRECT_RESPONSE_PREFIX}${content}`;
}

export function extractDirectResponse(response: string): string | undefined {
	return response.startsWith(DIRECT_RESPONSE_PREFIX)
		? response.slice(DIRECT_RESPONSE_PREFIX.length)
		: undefined;
}

export const discordRuntime: DiscordToolRuntime = {};
export const discordContextStorage = new AsyncLocalStorage<ConversationContext>();
const directResponseStorage = new AsyncLocalStorage<{ content?: string }>();

export function runDirectResponseScope<T>(callback: () => Promise<T>): Promise<T> {
	return directResponseStorage.run({}, callback);
}

export function getDirectResponse(): string | undefined {
	return directResponseStorage.getStore()?.content;
}

export async function sendDirectResponse(content: string): Promise<void> {
	const context = getToolContext();
	if (!context)
		throw new Error("La réponse directe doit être appelée pendant une réponse Discord.");
	const channel = await requireClient().channels.fetch(context.channelId);
	if (!channel?.isSendable())
		throw new Error("Le salon courant ne permet pas d'envoyer une réponse.");
	await channel.send({ content, allowedMentions: { parse: [] } });
	const state = directResponseStorage.getStore();
	if (!state) throw new Error("Le contexte de réponse directe n'est pas disponible.");
	state.content = content;
}

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

export function requireCategory(guild: Guild, categoryId: string): CategoryChannel {
	const context = getToolContext();
	const currentChannel =
		categoryId === "current" && context?.channelId
			? guild.channels.cache.get(context.channelId)
			: undefined;
	const resolvedId =
		categoryId === "current"
			? currentChannel?.type === ChannelType.GuildCategory
				? currentChannel.id
				: currentChannel?.parentId
			: categoryId;
	const category = resolvedId ? guild.channels.cache.get(resolvedId) : undefined;
	if (!category || category.type !== ChannelType.GuildCategory) {
		throw new Error("Catégorie introuvable ou hors périmètre.");
	}
	return category;
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
	if (!discordRuntime.questions)
		throw new Error("Le gestionnaire de questions n'est pas configuré.");
	if (token) {
		discordRuntime.questions.consume(token, action, targetIds);
		return;
	}
	const result = await discordRuntime.questions.requestApproval(description, [
		{ action, targetIds },
	]);
	if (!result.approved || !result.token) throw new Error("Action refusée ou approbation expirée.");
	discordRuntime.questions.consume(result.token, action, targetIds);
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
