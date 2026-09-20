import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { approve, requireChannel, requireGuild } from "./discord-runtime";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const id = z.string().min(1);

const crosspost = toolDefinition({
	name: "crosspost_message",
	description: "Publie un message d'annonce dans ses salons abonnés.",
	inputSchema: z.object({ channelId: id, messageId: id }),
	outputSchema: anyResult,
});
const suppressEmbeds = toolDefinition({
	name: "suppress_message_embeds",
	description: "Active ou désactive les embeds d'un message.",
	inputSchema: z.object({ channelId: id, messageId: id, suppress: z.boolean() }),
	outputSchema: anyResult,
});
const pollResults = toolDefinition({
	name: "get_poll_results",
	description: "Retourne les résultats d'un sondage Discord.",
	inputSchema: z.object({ channelId: id, messageId: id }),
	outputSchema: anyResult,
});
const endPoll = toolDefinition({
	name: "end_poll",
	description: "Clôture un sondage Discord après approbation.",
	inputSchema: z.object({ channelId: id, messageId: id, approvalToken: z.string().optional() }),
	outputSchema: anyResult,
});
export default [
	crosspost.server(async ({ channelId, messageId }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId) as any;
		const message = await channel.messages.fetch(messageId);
		return { id: (await message.crosspost()).id, published: true };
	}),
	suppressEmbeds.server(async ({ channelId, messageId, suppress }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId) as any;
		const message = await channel.messages.fetch(messageId);
		return { id: (await message.suppressEmbeds(suppress)).id, suppress };
	}),
	pollResults.server(async ({ channelId, messageId }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId) as any;
		const message = await channel.messages.fetch(messageId);
		if (!message.poll) throw new Error("Ce message ne contient pas de sondage.");
		return {
			question: message.poll.question.text,
			answers: [...message.poll.answers.values()].map((answer: any) => ({
				id: answer.id,
				text: answer.text ?? null,
				emoji: answer.emoji ?? null,
				count: answer.voteCount ?? answer.count ?? 0,
			})),
		};
	}),
	endPoll.server(async ({ channelId, messageId, approvalToken }, execution: Exec) => {
		await approve("end_poll", [messageId], approvalToken, `Clôturer le sondage ${messageId}`);
		const channel = requireChannel(requireGuild(execution.context), channelId) as any;
		const message = await channel.messages.fetch(messageId);
		return { ended: true, id: (await message.endPoll()).id };
	}),
];
