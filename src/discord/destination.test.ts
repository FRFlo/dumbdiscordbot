import { describe, expect, test } from "bun:test";
import { discordContextStorage } from "../tools/discord-runtime";
import { parseDiscordDestination } from "./destination";

describe("destinations Discord", () => {
	test("parse les salons, threads et DM", () => {
		expect(parseDiscordDestination("discord:channel:123")).toEqual({
			type: "channel",
			channelId: "123",
		});
		expect(parseDiscordDestination("discord:channel:123:thread:456")).toEqual({
			type: "channel",
			channelId: "123",
			threadId: "456",
		});
		expect(parseDiscordDestination("discord:dm:789")).toEqual({
			type: "dm",
			userId: "789",
		});
		expect(parseDiscordDestination("discord:group:987")).toEqual({
			type: "group",
			channelId: "987",
		});
	});

	test("résout current depuis le contexte du déclencheur", () => {
		expect(
			parseDiscordDestination("current", {
				channelId: "123",
				authorId: "456",
				authorName: "Test",
				content: "",
			}),
		).toEqual({ type: "current" });
		expect(
			discordContextStorage.run(
				{ channelId: "123", authorId: "456", authorName: "Test", content: "" },
				() => parseDiscordDestination("discord:dm:456"),
			),
		).toEqual({ type: "dm", userId: "456" });
	});

	test("rejette les destinations ambiguës ou hors format", () => {
		expect(() => parseDiscordDestination("discord:channel:abc")).toThrow();
		expect(() => parseDiscordDestination("discord:channel:123:thread")).toThrow();
		expect(() => parseDiscordDestination("slack:channel:123")).toThrow();
		expect(() => parseDiscordDestination("current")).toThrow();
	});
});
