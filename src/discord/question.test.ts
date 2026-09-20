import { describe, expect, test } from "bun:test";
import { ButtonStyle } from "discord.js";
import { questionOptionButtonStyle } from "./question";

describe("questions interactives", () => {
	test("colore les deux choix fermés en succès puis danger", () => {
		expect(questionOptionButtonStyle("closed", { value: "yes", label: "Oui" }, 0, false)).toBe(
			ButtonStyle.Success,
		);
		expect(questionOptionButtonStyle("closed", { value: "no", label: "Non" }, 1, false)).toBe(
			ButtonStyle.Danger,
		);
	});

	test("colore un choix multiple sélectionné en succès", () => {
		expect(questionOptionButtonStyle("multiple", { value: "one", label: "Un" }, 0, true)).toBe(
			ButtonStyle.Success,
		);
	});
});
