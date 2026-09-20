import { describe, expect, test } from "bun:test";
import { extractDirectResponse, formatDirectResponse } from "./discord-runtime";

describe("réponse directe", () => {
	test("encode et décode une réponse sans la republier", () => {
		const encoded = formatDirectResponse("Résultat calculé.");

		expect(extractDirectResponse(encoded)).toBe("Résultat calculé.");
		expect(extractDirectResponse("Réponse normale.")).toBeUndefined();
	});
});
