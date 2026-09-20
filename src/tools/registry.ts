import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { CodeModeTool } from "@tanstack/ai-code-mode";

type ToolModuleExport = CodeModeTool | readonly CodeModeTool[];
export interface RegisteredToolInfo {
	name: string;
	category: string;
	tags: readonly string[];
}

/** Registre central des tools exposés au modèle via TanStack AI Code Mode. */
export class ToolRegistry {
	private readonly tools: CodeModeTool[] = [];
	private readonly info = new Map<string, RegisteredToolInfo>();

	/** Charge un tool par fichier ou un groupe de tools exporté par fichier. */
	public async loadFromDirectory(directory = import.meta.dirname): Promise<void> {
		for (const file of await this.findToolFiles(directory)) {
			if (file.endsWith("registry.ts")) continue;
			const module = (await import(file)) as { default?: ToolModuleExport };
			if (!module.default) continue;
			const exports = Array.isArray(module.default) ? module.default : [module.default];
			const category = file.includes("discord-")
				? (file.split("discord-")[1]?.split(".")[0] ?? "discord")
				: "core";
			for (const tool of exports) this.register(tool, category);
		}
	}

	private async findToolFiles(directory: string): Promise<string[]> {
		const files: string[] = [];
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) files.push(...(await this.findToolFiles(path)));
			else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
		}
		return files;
	}

	public register(tool: CodeModeTool, category = "core"): void {
		if (this.tools.some((registered) => registered.name === tool.name)) {
			throw new Error(`Tool déjà enregistré : ${tool.name}`);
		}
		this.tools.push(tool);
		const destructive = /(?:delete|ban|kick|leave|remove|bulk|lockdown)/.test(tool.name);
		const tags = destructive
			? ["discord", "destructive", "requires-approval"]
			: ["discord", "sector-scoped"];
		this.info.set(tool.name, { name: tool.name, category, tags });
		tool.description = `[${category}] ${tool.description}${destructive ? " Action destructive : utilise approval avant l'exécution si nécessaire." : ""}`;
	}

	public all(): readonly CodeModeTool[] {
		return this.tools;
	}

	public catalog(): readonly RegisteredToolInfo[] {
		return [...this.info.values()];
	}
}
