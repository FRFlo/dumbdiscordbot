import { ChannelType, type Client, type Guild, type SendableChannels } from "discord.js";
import type { ConversationContext } from "../domain/types";
import {
	getToolContext,
	requireChannel,
	requireClient,
	requireGuild,
} from "../tools/discord-runtime";

export type DiscordDestination =
	| { type: "current" }
	| { type: "channel"; channelId: string; threadId?: string }
	| { type: "dm"; userId: string }
	| { type: "group"; channelId: string };

const snowflake = /^[0-9]{1,32}$/;

function assertSnowflake(value: string, label: string): string {
	if (!snowflake.test(value)) throw new Error(`${label} doit être un identifiant Discord valide.`);
	return value;
}

export function parseDiscordDestination(
	value: string,
	context?: ConversationContext,
): DiscordDestination {
	context = getToolContext(context);
	if (value === "current") {
		if (!context?.channelId)
			throw new Error("La destination current nécessite un contexte Discord.");
		return { type: "current" };
	}
	if (snowflake.test(value)) return { type: "channel", channelId: value };
	const parts = value.split(":");
	if (parts[0] !== "discord") throw new Error("La destination doit commencer par discord:.");
	if (parts[1] === "channel" && parts.length === 3) {
		return { type: "channel", channelId: assertSnowflake(parts[2]!, "channelId") };
	}
	if (parts[1] === "channel" && parts.length === 5 && parts[3] === "thread") {
		return {
			type: "channel",
			channelId: assertSnowflake(parts[2]!, "channelId"),
			threadId: assertSnowflake(parts[4]!, "threadId"),
		};
	}
	if (parts[1] === "dm" && parts.length === 3) {
		return { type: "dm", userId: assertSnowflake(parts[2]!, "userId") };
	}
	if (parts[1] === "group" && parts.length === 3) {
		return { type: "group", channelId: assertSnowflake(parts[2]!, "channelId") };
	}
	throw new Error(
		"Destination invalide. Formats acceptés : current, discord:channel:<id>, discord:channel:<id>:thread:<id>, discord:dm:<id> ou discord:group:<id>.",
	);
}

async function resolveGuildMember(guild: Guild, userId: string) {
	try {
		return await guild.members.fetch(userId);
	} catch {
		throw new Error("L'utilisateur DM doit être membre du serveur courant.");
	}
}

export async function resolveDiscordDestination(
	destination: DiscordDestination,
	context?: ConversationContext,
): Promise<SendableChannels> {
	context = getToolContext(context);
	const client: Client = requireClient();
	if (destination.type === "current") {
		if (!context?.channelId)
			throw new Error("La destination current nécessite un contexte Discord.");
		const channel = await client.channels.fetch(context.channelId);
		if (!channel?.isSendable()) throw new Error("Le salon du déclencheur ne permet pas l'envoi.");
		if (context.guildId && !("guildId" in channel && channel.guildId === context.guildId))
			throw new Error("Le salon du déclencheur est hors du serveur courant.");
		return channel;
	}
	if (destination.type === "channel") {
		const guild = requireGuild(context);
		const channel = requireChannel(guild, destination.channelId);
		if (destination.threadId) {
			const thread = await client.channels.fetch(destination.threadId);
			if (
				!thread?.isThread() ||
				thread.guildId !== guild.id ||
				thread.parentId !== destination.channelId
			) {
				throw new Error("Le thread ne correspond pas au salon Discord indiqué.");
			}
			if (!thread.isSendable()) throw new Error("Le thread ne permet pas l'envoi de messages.");
			return thread;
		}
		if (!channel.isSendable()) throw new Error("Le salon ne permet pas l'envoi de messages.");
		return channel;
	}
	if (destination.type === "group") {
		const channel = await client.channels.fetch(destination.channelId);
		if (!channel?.isDMBased() || channel.type !== ChannelType.GroupDM || !channel.isSendable())
			throw new Error("Le salon indiqué n'est pas un message privé de groupe accessible.");
		return channel;
	}

	if (context?.guildId) await resolveGuildMember(requireGuild(context), destination.userId);
	else if (context?.authorId !== destination.userId)
		throw new Error("En message privé, la destination doit être l'auteur du message courant.");

	const user = await client.users.fetch(destination.userId);
	return user.createDM();
}
