import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Client } from "discord.js";
import type { BotEvent } from "../../types";

export async function loadEvents(client: Client): Promise<void> {
	const directory = join(import.meta.dirname, "../../events");
	for (const file of (await readdir(directory)).filter((name) => name.endsWith(".ts"))) {
		const event: BotEvent = (await import(join(directory, file))).default;
		const handler = (...args: unknown[]) =>
			void (event.execute as (...values: unknown[]) => void)(...args);
		// Les événements sont chargés dynamiquement ; leur tuple d'arguments est
		// connu par chaque module mais ne peut pas être inféré depuis le fichier.
		if (event.once) client.once(event.name as never, handler as never);
		else client.on(event.name as never, handler as never);
		client.logger.debug("Événement chargé", { event: event.name, file });
	}
}
