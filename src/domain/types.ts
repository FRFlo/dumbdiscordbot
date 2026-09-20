export type ToolRisk = "low" | "medium" | "high";

export interface ConversationContext {
  content: string;
  authorId: string;
  authorName: string;
  guildId?: string;
  channelId: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  risk: ToolRisk;
  parameters: Record<string, unknown>;
}

export interface ToolExecutionContext {
  conversation: ConversationContext;
}

export interface Tool {
  definition: ToolDefinition;
  execute(input: unknown, context: ToolExecutionContext): Promise<unknown>;
}

export interface ModelCompletion {
  content: string;
  toolCalls: ToolCall[];
}
