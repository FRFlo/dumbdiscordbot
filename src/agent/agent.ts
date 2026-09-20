import type { ConversationContext, ChatMessage } from "../domain/types";
import type { ModelProvider } from "../providers/model-provider";
import { SafetyPolicy } from "../safety/policy";
import { ToolRegistry } from "../tools/registry";
import type { Logger } from "../observability/logger";

const SYSTEM_PROMPT = "Tu es un assistant Discord utile. Utilise uniquement les tools disponibles et respecte les permissions.";

export class Agent {
  public constructor(
    private readonly provider: ModelProvider,
    private readonly tools: ToolRegistry,
    private readonly policy: SafetyPolicy,
    private readonly logger: Logger,
    private readonly maxIterations: number,
  ) {}

  public async respond(context: ConversationContext): Promise<string> {
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `${context.authorName}: ${context.content}` },
    ];

    for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
      const completion = await this.provider.complete(messages, this.tools.definitions());
      if (completion.toolCalls.length === 0) return completion.content || "Je n'ai pas de réponse à fournir.";

      messages.push({ role: "assistant", content: completion.content, toolCalls: completion.toolCalls });
      for (const call of completion.toolCalls) {
        const tool = this.tools.definitions().find((definition) => definition.name === call.name);
        if (!tool || !this.policy.canExecute(tool.risk)) {
          messages.push({ role: "tool", toolCallId: call.id, content: "Tool refusé par la policy de sécurité." });
          continue;
        }
        try {
          const result = await this.tools.execute(call.name, JSON.parse(call.arguments), { conversation: context });
          messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
        } catch (error) {
          this.logger.warn("Échec d'exécution d'un tool", { tool: call.name, error: String(error) });
          messages.push({ role: "tool", toolCallId: call.id, content: "Le tool a échoué." });
        }
      }
    }
    return "Je n'ai pas pu terminer cette demande dans la limite autorisée.";
  }
}
