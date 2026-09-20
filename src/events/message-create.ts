import type { Message } from "discord.js";
import type { BotEvent } from "../types";

const SILENT_RESPONSE = "[SILENT]";

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

    const content = message.content.replace(/<@!?(\d+)>/g, "").trim();
    if (!content) return;

    const state = addressed ? message.client.followUps.begin(key) : activeConversation;
    if (!state) return;
    try {
      const response = await message.client.agent.respond({
        content,
        authorId: message.author.id,
        authorName: message.author.username,
        guildId: message.guildId ?? undefined,
        channelId: message.channelId,
        isFollowUp: !addressed,
        history: state.history,
      }, Number(Bun.env.MAX_AGENT_ITERATIONS ?? 5));

      if (response.trim() === SILENT_RESPONSE) {
        message.client.followUps.clear(key);
        return;
      }
      message.client.followUps.record(key, content, response);
      await message.reply({ content: response.slice(0, 2000), allowedMentions: { repliedUser: false } });
    } catch (error) {
      message.client.logger.error("Erreur de traitement d'un message", { error: String(error) });
      message.client.observability.captureError(error, {
        area: "discord.message_create",
        distinct_id: `discord:${message.author.id}`,
      });
    }
  },
};

export default event;
