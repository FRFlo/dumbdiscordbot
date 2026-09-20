import { describe, expect, test } from "bun:test";
import { isDiscordClientEvent } from "./event-addons";

describe("addons d'événements Discord", () => {
	test("accepte les événements discord.js connus", () => {
		expect(isDiscordClientEvent("messageCreate")).toBe(true);
		expect(isDiscordClientEvent("guildMemberAdd")).toBe(true);
	});

	test("refuse un nom d'événement inconnu", () => {
		expect(isDiscordClientEvent("eventInventé")).toBe(false);
	});
});
