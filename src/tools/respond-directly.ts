import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { sendDirectResponse } from "./discord-runtime";

const definition = toolDefinition({
	name: "respond_directly",
	description:
		"Envoie immédiatement la réponse finale dans le salon Discord courant. À utiliser uniquement quand le script a déjà produit la réponse complète.",
	inputSchema: z.object({ content: z.string().min(1).max(2_000) }),
	outputSchema: z.object({ handled: z.literal(true) }),
});

export default definition.server(async ({ content }) => {
	await sendDirectResponse(content);
	return { handled: true as const };
});
