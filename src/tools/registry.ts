import type { Tool, ToolDefinition, ToolExecutionContext } from "../domain/types";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  public register(tool: Tool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Tool déjà enregistré : ${tool.definition.name}`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  public definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  public async execute(name: string, input: unknown, context: ToolExecutionContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool inconnu : ${name}`);
    return tool.execute(input, context);
  }
}
