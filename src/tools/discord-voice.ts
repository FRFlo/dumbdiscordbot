import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { approve, requireChannel, requireGuild } from "./discord-runtime";
import { channelSummary } from "./discord-helpers";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const id = z.string().min(1);

const voiceSettings = toolDefinition({
	name: "edit_voice_channel_settings",
	description: "Modifie les paramètres d'un salon vocal.",
	inputSchema: z.object({
		channelId: id,
		bitrate: z.number().int().min(8).max(384).optional(),
		userLimit: z.number().int().min(0).max(99).optional(),
		rtcRegion: z.string().nullable().optional(),
	}),
	outputSchema: anyResult,
});
const stage = toolDefinition({
	name: "create_stage_instance",
	description: "Crée une instance Stage dans un salon vocal Stage.",
	inputSchema: z.object({
		channelId: id,
		topic: z.string().min(1).max(120),
		privacyLevel: z.enum(["public", "guild_only"]).default("guild_only"),
	}),
	outputSchema: anyResult,
});
const endStage = toolDefinition({
	name: "end_stage_instance",
	description: "Termine une instance Stage.",
	inputSchema: z.object({ channelId: id, approvalToken: z.string().optional() }),
	outputSchema: anyResult,
});
export default [
	voiceSettings.server(async ({ channelId, bitrate, userLimit, rtcRegion }, execution: Exec) => {
		const channel = requireChannel(requireGuild(execution.context), channelId) as any;
		return channelSummary(await channel.edit({ bitrate, userLimit, rtcRegion }));
	}),
	stage.server(async ({ channelId, topic, privacyLevel }, execution: Exec) => {
		const stageChannel = requireChannel(requireGuild(execution.context), channelId) as any;
		const instance = await requireGuild(execution.context).stageInstances.create(stageChannel, {
			topic,
			privacyLevel: privacyLevel === "public" ? 1 : 2,
		} as any);
		return {
			id: instance.id,
			channelId: instance.channelId,
			topic: instance.topic,
			privacyLevel: instance.privacyLevel,
		};
	}),
	endStage.server(async ({ channelId, approvalToken }, execution: Exec) => {
		await approve(
			"end_stage_instance",
			[channelId],
			approvalToken,
			`Terminer le Stage ${channelId}`,
		);
		const instance = (await requireGuild(execution.context).stageInstances.fetch(channelId)) as any;
		await instance.delete();
		return { ended: true, channelId };
	}),
];
