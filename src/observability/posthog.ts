import { PostHog } from "posthog-node";
import type { AppConfig } from "../config";
import type { Logger } from "./logger";

interface AiRunMetadata {
  distinctId: string;
  model: string;
  provider: string;
  guildId?: string;
  channelId: string;
  toolCount: number;
}

interface StreamChunk {
  type?: string;
  delta?: string;
  toolName?: string;
  toolCallId?: string;
  finishReason?: string;
}

/** Télémétrie applicative et IA, sans capturer les prompts par défaut. */
export class PostHogObservability {
  private readonly client?: PostHog;

  public constructor(config: AppConfig, private readonly logger: Logger) {
    if (!config.posthogApiKey) {
      logger.info("PostHog désactivé : POSTHOG_API_KEY absent");
      return;
    }
    this.client = new PostHog(config.posthogApiKey, {
      host: config.posthogHost,
      flushAt: 10,
      flushInterval: 10_000,
      disableGeoip: true,
    });
    logger.info("PostHog activé", { host: config.posthogHost });
  }

  public capture(event: string, distinctId: string, properties: Record<string, unknown> = {}): void {
    this.client?.capture({ distinctId, event, properties });
  }

  public captureError(error: unknown, properties: Record<string, unknown> = {}): void {
    const distinctId = typeof properties.distinct_id === "string" ? properties.distinct_id : "system";
    this.client?.captureException(error, distinctId, properties);
  }

  public captureAiStarted(runId: string, metadata: AiRunMetadata): void {
    this.capture("ai_run_started", metadata.distinctId, {
      run_id: runId,
      provider: metadata.provider,
      model: metadata.model,
      guild_id: metadata.guildId,
      channel_id: metadata.channelId,
      tool_count: metadata.toolCount,
    });
  }

  public captureAiCompleted(runId: string, distinctId: string, properties: Record<string, unknown>): void {
    this.capture("ai_run_completed", distinctId, { run_id: runId, ...properties });
  }

  public captureAiFailed(runId: string, distinctId: string, error: unknown): void {
    this.client?.captureException(error, distinctId, { ai_run_id: runId });
    this.capture("ai_run_failed", distinctId, { run_id: runId, error_type: error instanceof Error ? error.name : typeof error });
  }

  /** Consomme un stream TanStack AI tout en observant les étapes importantes. */
  public async observeAiStream(
    stream: AsyncIterable<unknown>,
    runId: string,
    distinctId: string,
  ): Promise<string> {
    let response = "";
    let toolCalls = 0;
    for await (const value of stream) {
      const chunk = value as StreamChunk;
      if (chunk.type === "TEXT_MESSAGE_CONTENT") response += chunk.delta ?? "";
      if (chunk.type === "TOOL_CALL_START") {
        toolCalls += 1;
        this.capture("ai_tool_call_started", distinctId, {
          run_id: runId,
          tool_name: chunk.toolName,
          tool_call_id: chunk.toolCallId,
        });
      }
      if (chunk.type === "TOOL_CALL_END") {
        this.capture("ai_tool_call_finished", distinctId, {
          run_id: runId,
          tool_call_id: chunk.toolCallId,
        });
      }
      if (chunk.type === "RUN_FINISHED") {
        this.capture("ai_run_finished", distinctId, {
          run_id: runId,
          finish_reason: chunk.finishReason,
          tool_calls: toolCalls,
        });
      }
    }
    return response;
  }

  public async shutdown(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.shutdown(5_000);
    } catch (error) {
      this.logger.warn("Échec du flush PostHog", { error: String(error) });
    }
  }
}
