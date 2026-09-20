import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { requireGuild } from "./discord-runtime";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const id = z.string().min(1);

const threadMembers = toolDefinition({
	name: "list_thread_members",
	description: "Liste les membres d'un thread Discord.",
	inputSchema: z.object({ threadId: id, guildId: id.optional() }),
	outputSchema: anyResult,
});
const addThreadMember = toolDefinition({
	name: "add_thread_member",
	description: "Ajoute un membre à un thread Discord.",
	inputSchema: z.object({ threadId: id, userId: id, guildId: id.optional() }),
	outputSchema: anyResult,
});
const removeThreadMember = toolDefinition({
	name: "remove_thread_member",
	description: "Retire un membre d'un thread Discord.",
	inputSchema: z.object({ threadId: id, userId: id, guildId: id.optional() }),
	outputSchema: anyResult,
});
const joinThread = toolDefinition({
	name: "join_thread",
	description: "Fait rejoindre le bot à un thread Discord.",
	inputSchema: z.object({ threadId: id, guildId: id.optional() }),
	outputSchema: anyResult,
});
const leaveThread = toolDefinition({
	name: "leave_thread",
	description: "Fait quitter le bot d'un thread Discord.",
	inputSchema: z.object({ threadId: id, guildId: id.optional() }),
	outputSchema: anyResult,
});
export default [
	threadMembers.server(async ({ threadId, guildId }, execution: Exec) => {
		const thread = requireGuild(execution.context, guildId).channels.cache.get(threadId) as any;
		if (!thread?.isThread()) throw new Error("Thread introuvable.");
		return {
			members: [...(await thread.members.fetch()).values()].map((member: any) => ({
				id: member.id,
				userId: member.user?.id ?? member.id,
			})),
		};
	}),
	addThreadMember.server(async ({ threadId, userId, guildId }, execution: Exec) => {
		const thread = requireGuild(execution.context, guildId).channels.cache.get(threadId) as any;
		if (!thread?.isThread()) throw new Error("Thread introuvable.");
		await thread.members.add(userId);
		return { added: true, threadId, userId };
	}),
	removeThreadMember.server(async ({ threadId, userId, guildId }, execution: Exec) => {
		const thread = requireGuild(execution.context, guildId).channels.cache.get(threadId) as any;
		if (!thread?.isThread()) throw new Error("Thread introuvable.");
		await thread.members.remove(userId);
		return { removed: true, threadId, userId };
	}),
	joinThread.server(async ({ threadId, guildId }, execution: Exec) => {
		const thread = requireGuild(execution.context, guildId).channels.cache.get(threadId) as any;
		if (!thread?.isThread()) throw new Error("Thread introuvable.");
		await thread.join();
		return { joined: true, threadId };
	}),
	leaveThread.server(async ({ threadId, guildId }, execution: Exec) => {
		const thread = requireGuild(execution.context, guildId).channels.cache.get(threadId) as any;
		if (!thread?.isThread()) throw new Error("Thread introuvable.");
		await thread.leave();
		return { left: true, threadId };
	}),
];
