import { chat, maxIterations } from "@tanstack/ai";
import { createCodeMode } from "@tanstack/ai-code-mode";
import { createQuickJSBunIsolateDriver } from "@tanstack/ai-isolate-quickjs-bun";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import type { AppConfig } from "../config";
import type { ConversationContext } from "../domain/types";
import type { Logger } from "../observability/logger";
import type { PostHogObservability } from "../observability/posthog";
import { ToolRegistry } from "../tools/registry";

const SYSTEM_PROMPT = [
  "Tu es un assistant Discord utile et prudent.",
  "Utilise les tools disponibles uniquement quand ils sont nécessaires.",
  "Respecte toujours le contexte Discord et les permissions de l'utilisateur.",
].join(" ");

export class Agent {
  private readonly adapter;
  private readonly codeMode;
  private readonly model: string;

  public constructor(
    config: AppConfig,
    private readonly tools: ToolRegistry,
    private readonly logger: Logger,
    private readonly observability: PostHogObservability,
  ) {
    this.model = config.openAiModel;
    this.adapter = openaiCompatibleText(config.openAiModel, {
      baseURL: config.openAiBaseUrl,
      apiKey: config.openAiApiKey,
    });
    this.codeMode = createCodeMode({
      driver: createQuickJSBunIsolateDriver({
        timeout: config.codeModeTimeout,
        memoryLimit: config.codeModeMemoryLimit,
        maxStackSize: config.codeModeMaxStackSize,
        maxToolCalls: config.codeModeMaxToolCalls,
      }),
      tools: [...this.tools.all()],
      timeout: config.codeModeTimeout,
      memoryLimit: config.codeModeMemoryLimit,
    });
  }

  public async respond(context: ConversationContext, maxAgentIterations: number): Promise<string> {
    const runId = crypto.randomUUID();
    const distinctId = `discord:${context.authorId}`;
    const startedAt = Date.now();
    this.observability.captureAiStarted(runId, {
      distinctId,
      model: this.model,
      provider: "openai-compatible",
      guildId: context.guildId,
      channelId: context.channelId,
      toolCount: this.codeMode.tools.length,
    });
    try {
      const stream = chat({
        adapter: this.adapter,
        messages: [{ role: "user", content: `${context.authorName}: ${context.content}` }],
        systemPrompts: [SYSTEM_PROMPT, this.codeMode.systemPrompt],
        tools: [...this.codeMode.tools],
        context,
        agentLoopStrategy: maxIterations(maxAgentIterations),
      });
      const response = (await this.observability.observeAiStream(stream, runId, distinctId)) || "Je n'ai pas de réponse à fournir.";
      this.observability.captureAiCompleted(runId, distinctId, {
        duration_ms: Date.now() - startedAt,
        response_chars: response.length,
      });
      return response;
    } catch (error) {
      this.logger.error("Échec de l'exécution TanStack AI", { error: String(error) });
      this.observability.captureAiFailed(runId, distinctId, error);
      return "Je n'ai pas pu traiter cette demande pour le moment.";
    }
  }
}
