import { PostHog } from "posthog-node";
import type { AppConfig } from "../config";
import type { Logger } from "./logger";

interface AiRunMetadata {
	distinctId: string;
	model: string;
	provider: string;
	guildId?: string;
	channelId: string;
	sessionId: string;
	intent: string;
	input: string;
	toolCount: number;
}

interface StreamChunk {
	type?: string;
	delta?: string;
	toolName?: string;
	toolCallName?: string;
	toolCallId?: string;
	input?: unknown;
	content?: string;
	finishReason?: string;
}

interface ToolCallState {
	name: string;
	startedAt: number;
	input?: unknown;
}

/** Télémétrie PostHog AI Observability et MCP Analytics. */
export class PostHogObservability {
	private readonly client?: PostHog;

	public constructor(
		private readonly config: AppConfig,
		private readonly logger: Logger,
	) {
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

	public capture(
		event: string,
		distinctId: string,
		properties: Record<string, unknown> = {},
	): void {
		this.client?.capture({ distinctId, event, properties });
	}

	public captureError(error: unknown, properties: Record<string, unknown> = {}): void {
		const distinctId =
			typeof properties.distinct_id === "string" ? properties.distinct_id : "system";
		this.client?.captureException(error, distinctId, properties);
	}

	public captureAiStarted(runId: string, metadata: AiRunMetadata): void {
		this.capture("$ai_trace", metadata.distinctId, {
			$ai_trace_id: runId,
			$ai_session_id: metadata.sessionId,
			$ai_span_name: "discord_agent",
			$ai_input_state: this.config.posthogCaptureAiContent
				? { content: metadata.input }
				: { content_length: metadata.input.length },
			$ai_is_error: false,
			model: metadata.model,
			provider: metadata.provider,
			guild_id: metadata.guildId,
			channel_id: metadata.channelId,
			tool_count: metadata.toolCount,
		});
	}

	public captureAiCompleted(
		runId: string,
		distinctId: string,
		properties: Record<string, unknown>,
	): void {
		this.capture("$ai_generation", distinctId, {
			$ai_trace_id: runId,
			$ai_session_id: properties.session_id,
			$ai_span_name: "discord_agent_response",
			$ai_model: properties.model,
			$ai_provider: "openai-compatible",
			$ai_latency: Number(properties.duration_ms ?? 0) / 1000,
			$ai_stream: true,
			$ai_input: this.config.posthogCaptureAiContent
				? [{ role: "user", content: properties.input }]
				: [{ role: "user", content: "[redacted]" }],
			$ai_output_choices: this.config.posthogCaptureAiContent
				? [{ role: "assistant", content: properties.response }]
				: [{ role: "assistant", content: "[redacted]" }],
			$ai_is_error: false,
			$ai_stop_reason: properties.finish_reason,
			$ai_tools: properties.tool_calls,
			discord_channel_id: properties.channel_id,
		});
	}

	public captureAiFailed(
		runId: string,
		distinctId: string,
		error: unknown,
		metadata: Record<string, unknown> = {},
	): void {
		const message = error instanceof Error ? error.message : String(error);
		this.capture("$ai_generation", distinctId, {
			$ai_trace_id: runId,
			$ai_session_id: metadata.session_id,
			$ai_model: metadata.model,
			$ai_provider: "openai-compatible",
			$ai_is_error: true,
			$ai_error: message,
			$ai_latency: Number(metadata.duration_ms ?? 0) / 1000,
		});
		this.client?.captureException(error, distinctId, { $ai_trace_id: runId });
	}

	/** Observe les étapes TanStack AI et les publie dans les traces PostHog. */
	public async observeAiStream(
		stream: AsyncIterable<unknown>,
		runId: string,
		distinctId: string,
		metadata: { sessionId: string; model: string; intent: string },
	): Promise<{ response: string; toolCalls: string[]; finishReason?: string }> {
		let response = "";
		let finishReason: string | undefined;
		const toolCalls: string[] = [];
		const pending = new Map<string, ToolCallState>();

		for await (const value of stream) {
			const chunk = value as StreamChunk;
			if (chunk.type === "TEXT_MESSAGE_CONTENT") response += chunk.delta ?? "";
			if (chunk.type === "RUN_FINISHED") finishReason = chunk.finishReason;
			if (chunk.type === "TOOL_CALL_START") {
				const id = chunk.toolCallId ?? crypto.randomUUID();
				pending.set(id, {
					name: chunk.toolCallName ?? chunk.toolName ?? "unknown",
					startedAt: Date.now(),
				});
				toolCalls.push(chunk.toolCallName ?? chunk.toolName ?? "unknown");
			}
			if (chunk.type === "TOOL_CALL_END" && chunk.toolCallId) {
				const call = pending.get(chunk.toolCallId);
				if (call) call.input = chunk.input;
			}
			if (chunk.type === "TOOL_CALL_RESULT" && chunk.toolCallId) {
				const call = pending.get(chunk.toolCallId);
				if (call) {
					this.captureToolCall(
						runId,
						distinctId,
						metadata,
						chunk.toolCallId,
						call,
						chunk.content,
						false,
					);
					pending.delete(chunk.toolCallId);
				}
			}
		}
		for (const [id, call] of pending) {
			this.captureToolCall(runId, distinctId, metadata, id, call, undefined, false);
		}
		return { response, toolCalls, finishReason };
	}

	private captureToolCall(
		runId: string,
		distinctId: string,
		metadata: { sessionId: string; model: string; intent: string },
		toolCallId: string,
		call: ToolCallState,
		output: unknown,
		isError: boolean,
	): void {
		const durationMs = Date.now() - call.startedAt;
		const payload = this.config.posthogCaptureToolPayloads ? call.input : { redacted: true };
		const result = this.config.posthogCaptureToolPayloads ? output : { redacted: true };
		this.capture("$ai_span", distinctId, {
			$ai_trace_id: runId,
			$ai_session_id: metadata.sessionId,
			$ai_span_id: toolCallId,
			$ai_parent_id: runId,
			$ai_span_name: `tool:${call.name}`,
			$ai_input_state: payload,
			$ai_output_state: result,
			$ai_latency: durationMs / 1000,
			$ai_is_error: isError,
		});
		this.capture("$mcp_tool_call", distinctId, {
			$mcp_source: "posthog_mcp_analytics",
			$mcp_server_name: "dumbdiscordbot-code-mode",
			$mcp_tool_name: call.name,
			$mcp_parameters: payload,
			$mcp_response: result,
			$mcp_duration_ms: durationMs,
			$mcp_is_error: isError,
			$mcp_llm_model: metadata.model,
			$mcp_llm_model_source: "self_reported",
			$mcp_conversation_id: metadata.sessionId,
			$ai_trace_id: runId,
			...(this.config.posthogCaptureAiContent
				? { $mcp_intent: metadata.intent, $mcp_intent_source: "inferred" }
				: {}),
		});
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
