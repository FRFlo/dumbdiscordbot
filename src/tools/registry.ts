import type { CodeModeTool } from "@tanstack/ai-code-mode";

/** Registre central des tools exposés au modèle via TanStack AI Code Mode. */
export class ToolRegistry {
  private readonly tools: CodeModeTool[] = [];

  public register(tool: CodeModeTool): void {
    if (this.tools.some((registered) => registered.name === tool.name)) {
      throw new Error(`Tool déjà enregistré : ${tool.name}`);
    }
    this.tools.push(tool);
  }

  public all(): readonly CodeModeTool[] {
    return this.tools;
  }
}
