import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ChatMessage, ModelCompletion, ToolDefinition } from "../domain/types";
import type { ModelProvider } from "./model-provider";

export class OpenAiCompatibleProvider implements ModelProvider {
  private readonly client: OpenAI;

  public constructor(
    private readonly model: string,
    baseURL: string,
    apiKey: string,
  ) {
    this.client = new OpenAI({ baseURL, apiKey });
  }

  public async complete(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelCompletion> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
        ...(message.toolCalls
          ? { tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.arguments },
            })) }
          : {}),
      })) as unknown as ChatCompletionMessageParam[],
      tools: tools.length > 0
        ? tools.map((tool) => ({
            type: "function" as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          }))
        : undefined,
    });

    const message = response.choices[0]?.message;
    return {
      content: message?.content ?? "",
      toolCalls: message?.tool_calls?.flatMap((call) =>
        call.type === "function"
          ? [{ id: call.id, name: call.function.name, arguments: call.function.arguments }]
          : [],
      ) ?? [],
    };
  }
}
