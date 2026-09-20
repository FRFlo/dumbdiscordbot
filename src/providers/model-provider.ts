import type { ChatMessage, ModelCompletion, ToolDefinition } from "../domain/types";

export interface ModelProvider {
  complete(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelCompletion>;
}
