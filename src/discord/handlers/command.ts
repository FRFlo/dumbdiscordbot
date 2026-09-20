import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { REST, Routes, type Client } from "discord.js";
import type { AppConfig } from "../../config";
import type { SlashCommand } from "../../types";

export async function loadCommands(client: Client, config: AppConfig): Promise<void> {
	const directory = join(import.meta.dirname, "../../commands");
	const commands: ReturnType<SlashCommand["command"]["toJSON"]>[] = [];
	for (const file of (await readdir(directory)).filter((name) => name.endsWith(".ts"))) {
		const command: SlashCommand = (await import(join(directory, file))).default;
		client.commands.set(command.command.name, command);
		commands.push(command.command.toJSON());
	}

	const rest = new REST({ version: "10" }).setToken(config.discordToken);
	const route = config.discordGuildId
		? Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId)
		: Routes.applicationCommands(config.discordClientId);
	await rest.put(route, { body: commands });

	// Discord maintient des collections globales et de serveur séparées.
	// Nettoyer l'autre portée évite de conserver des commandes obsolètes.
	if (config.discordGuildId) {
		await rest.put(Routes.applicationCommands(config.discordClientId), { body: [] });
	} else {
		for (const guild of client.guilds.cache.values()) {
			await rest.put(Routes.applicationGuildCommands(config.discordClientId, guild.id), {
				body: [],
			});
		}
	}

	client.logger.info("Commandes synchronisées", {
		count: commands.length,
		scope: config.discordGuildId ? "guild" : "global",
		clearedOtherScopes: true,
	});
}
