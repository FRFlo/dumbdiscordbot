import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { approve, requireChannel, requireGuild } from "./discord-runtime";

type Exec = { context?: ConversationContext };
const react = toolDefinition({ name: "add_reaction", description: "Ajoute une réaction à un message après approbation.", inputSchema: z.object({ channelId: z.string(), messageId: z.string(), emoji: z.string().min(1).max(100) }), outputSchema: z.object({ reacted: z.boolean() }) });
const unreact = toolDefinition({ name: "remove_reaction", description: "Retire la réaction du bot après approbation.", inputSchema: z.object({ channelId: z.string(), messageId: z.string(), emoji: z.string().min(1).max(100) }), outputSchema: z.object({ removed: z.boolean() }) });
const reactions = toolDefinition({ name: "list_reactions", description: "Liste les réactions d'un message.", inputSchema: z.object({ channelId: z.string(), messageId: z.string() }), outputSchema: z.object({ reactions: z.array(z.object({ emoji: z.string(), count: z.number(), users: z.array(z.string()) })) }) });
const poll = toolDefinition({ name: "create_poll", description: "Crée un sondage Discord dans un salon après approbation.", inputSchema: z.object({ channelId: z.string(), question: z.string().min(1).max(300), answers: z.array(z.string().min(1).max(55)).min(2).max(10), durationHours: z.number().min(1).max(168).default(24), allowMultiselect: z.boolean().default(false) }), outputSchema: z.object({ id: z.string(), url: z.string() }) });

export default [
  react.server(async ({ channelId, messageId, emoji }, execution: Exec) => { const channel = requireChannel(requireGuild(execution.context), channelId); if (!("messages" in channel)) throw new Error("Salon non textuel."); await (await channel.messages.fetch(messageId)).react(emoji); return { reacted: true }; }),
  unreact.server(async ({ channelId, messageId, emoji }, execution: Exec) => { const channel = requireChannel(requireGuild(execution.context), channelId); if (!("messages" in channel)) throw new Error("Salon non textuel."); await (await channel.messages.fetch(messageId)).reactions.cache.get(emoji)?.users.remove(requireGuild(execution.context).client.user!.id); return { removed: true }; }),
  reactions.server(async ({ channelId, messageId }, execution: Exec) => { const channel = requireChannel(requireGuild(execution.context), channelId); if (!("messages" in channel)) throw new Error("Salon non textuel."); const message = await channel.messages.fetch(messageId); return { reactions: await Promise.all([...message.reactions.cache.values()].map(async (reaction) => ({ emoji: reaction.emoji.name ?? reaction.emoji.id ?? "unknown", count: reaction.count, users: [...(await reaction.users.fetch()).values()].map((user) => user.id) }))) }; }),
  poll.server(async ({ channelId, question, answers, durationHours, allowMultiselect }, execution: Exec) => { const channel = requireChannel(requireGuild(execution.context), channelId); if (!("send" in channel)) throw new Error("Salon non textuel."); const message = await channel.send({ poll: { question: { text: question }, answers: answers.map((text) => ({ text })), duration: durationHours ?? 24, allowMultiselect: allowMultiselect ?? false } }); return { id: message.id, url: message.url }; }),
];

