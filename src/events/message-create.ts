import type { Message } from "discord.js";
import type { BotEvent } from "../types";

const event: BotEvent<"messageCreate"> = {
  name: "messageCreate",
  execute: async (message: Message) => {
    if (message.author.bot || (message.guild && message.client.user && !message.mentions.has(message.client.user))) return;
    const content = message.content.replace(/<@!?\d+>/g, "").trim();
    if (!content) return;
    const response = await message.client.agent.respond({
      content,
      authorId: message.author.id,
      authorName: message.author.username,
      guildId: message.guildId ?? undefined,
      channelId: message.channelId,
    });
    await message.reply({ content: response.slice(0, 2000), allowedMentions: { repliedUser: false } });
  },
};

export default event;
