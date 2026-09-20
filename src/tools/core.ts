import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";

const echoDefinition = toolDefinition({
	name: "echo",
	description: "Répète un texte court pour vérifier qu'un tool fonctionne.",
	inputSchema: z.object({
		text: z.string().min(1).max(500),
	}),
	outputSchema: z.object({
		text: z.string(),
	}),
});

const getRuntimeInfoDefinition = toolDefinition({
	name: "get_runtime_info",
	description: "Retourne des informations non sensibles sur le runtime du bot.",
	inputSchema: z.object({}),
	outputSchema: z.object({
		runtime: z.string(),
		platform: z.string(),
	}),
});

/**
 * Exemple de fichier de groupe : plusieurs tools cohérents peuvent être
 * exportés ensemble. Un fichier individuel peut aussi exporter un seul tool.
 */
export default [
	echoDefinition.server(async ({ text }) => ({ text })),
	getRuntimeInfoDefinition.server(async () => ({
		runtime: "bun",
		platform: process.platform,
	})),
];
