import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { QuestionDefinition, QuestionManager } from "../discord/question";

const option = z.object({
	value: z.string().min(1).max(100),
	label: z.string().min(1).max(80),
	description: z.string().max(200).optional(),
	tone: z.enum(["success", "danger"]).optional(),
});

const definition = toolDefinition({
	name: "question",
	description:
		"Pose une question interactive dans Discord. Utilise closed pour deux choix, single pour un choix, multiple pour plusieurs choix et free pour une réponse libre.",
	inputSchema: z.discriminatedUnion("type", [
		z.object({
			type: z.literal("closed"),
			question: z.string().min(1).max(1_000),
			options: z.tuple([option, option]),
			timeoutMs: z.number().int().positive().max(120_000).optional(),
		}),
		z.object({
			type: z.literal("single"),
			question: z.string().min(1).max(1_000),
			options: z.array(option).min(1).max(20),
			allowOther: z.boolean().optional(),
			timeoutMs: z.number().int().positive().max(120_000).optional(),
		}),
		z.object({
			type: z.literal("multiple"),
			question: z.string().min(1).max(1_000),
			options: z.array(option).min(1).max(20),
			allowOther: z.boolean().optional(),
			minSelections: z.number().int().min(0).max(20).optional(),
			timeoutMs: z.number().int().positive().max(120_000).optional(),
		}),
		z.object({
			type: z.literal("free"),
			question: z.string().min(1).max(1_000),
			placeholder: z.string().max(100).optional(),
			timeoutMs: z.number().int().positive().max(120_000).optional(),
		}),
	]),
	outputSchema: z.object({
		type: z.enum(["closed", "single", "multiple", "free"]),
		answered: z.boolean(),
		value: z.string().optional(),
		values: z.array(z.string()).optional(),
	}),
});

/** Tool interactif : le manager reste hors de l'isolate Code Mode. */
export function createQuestionTool(manager: QuestionManager) {
	return definition.server(async (input) => manager.ask(input as QuestionDefinition));
}
