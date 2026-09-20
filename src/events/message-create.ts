import type { Message } from "discord.js";
import type { BotEvent } from "../types";
import { extractDirectResponse } from "../tools/discord-runtime";

const SILENT_RESPONSE = "[SILENT]";
const TYPING_REFRESH_MS = 8_000;

function conversationKey(message: Message): string {
	return `${message.guildId ?? "dm"}:${message.channelId}:${message.author.id}`;
}

const event: BotEvent<"messageCreate"> = {
	name: "messageCreate",
	execute: async (message: Message) => {
		if (message.author.bot) return;
		const mentioned = Boolean(message.client.user && message.mentions.has(message.client.user));
		const addressed = mentioned || !message.guildId;
		const key = conversationKey(message);
		const activeConversation = message.client.followUps.getActive(key);
		if (!addressed && !activeConversation) return;

		const content = message.content.replace(/<@!?([0-9]+)>/g, "").trim();
		if (!content) return;

		const state = addressed ? message.client.followUps.begin(key) : activeConversation;
		if (!state) return;

		const sendTyping = async (): Promise<void> => {
			if (!message.channel.isSendable()) return;
			try {
				await message.channel.sendTyping();
			} catch (error) {
				// L'indicateur est facultatif : une erreur Discord ne doit pas
				// empêcher la génération ou l'envoi de la réponse.
				message.client.logger.debug("Impossible d'afficher l'indicateur de saisie", {
					error: String(error),
				});
			}
		};

		await sendTyping();
		const typingInterval = setInterval(() => void sendTyping(), TYPING_REFRESH_MS);
		try {
			const response = await message.client.agent.respond(
				{
					content,
					authorId: message.author.id,
					authorName: message.author.username,
					guildId: message.guildId ?? undefined,
					channelId: message.channelId,
					isFollowUp: !addressed,
					history: state.history,
				},
				Number(Bun.env.MAX_AGENT_ITERATIONS ?? 5),
			);

			if (response.trim() === SILENT_RESPONSE) {
				message.client.followUps.clear(key);
				await message.reply({
					content: `${SILENT_RESPONSE} — L'agent a choisi de ne pas répondre à ce message.`,
					allowedMentions: { repliedUser: false },
				});
				return;
			}
			const directResponse = extractDirectResponse(response);
			if (directResponse !== undefined) {
				message.client.followUps.record(key, content, directResponse);
				return;
			}
			message.client.followUps.record(key, content, response);
			await message.reply({
				content: response.slice(0, 2000),
				allowedMentions: { repliedUser: false },
			});
		} catch (error) {
			message.client.logger.error("Erreur de traitement d'un message", { error: String(error) });
			message.client.observability.captureError(error, {
				area: "discord.message_create",
				distinct_id: `discord:${message.author.id}`,
			});
		} finally {
			clearInterval(typingInterval);
		}
	},
};

export default event;
