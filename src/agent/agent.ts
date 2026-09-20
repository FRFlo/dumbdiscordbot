import { chat, maxIterations } from "@tanstack/ai";
import { createCodeMode } from "@tanstack/ai-code-mode";
import { createQuickJSIsolateDriver } from "@tanstack/ai-isolate-quickjs";
import { createQuickJSBunIsolateDriver } from "@tanstack/ai-isolate-quickjs-bun";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import type { AppConfig } from "../config";
import type { ConversationContext } from "../domain/types";
import type { Logger } from "../observability/logger";
import type { PostHogObservability } from "../observability/posthog";
import { ToolRegistry } from "../tools/registry";
import type { ApprovalManager } from "../discord/approval";
import { discordContextStorage } from "../tools/discord-runtime";
import { SYSTEM_PROMPT, formatDiscordRequest, formatHistoryMessage } from "./system-prompt";

function createIsolateDriver(config: AppConfig, logger: Logger) {
	const isWindowsWithoutNativeLibrary =
		process.platform === "win32" && !Bun.env.QUICKJS_BUN_NATIVE_LIBRARY;
	if (isWindowsWithoutNativeLibrary) {
		logger.warn("QuickJS Bun natif indisponible sous Windows : fallback vers QuickJS WASM");
		return createQuickJSIsolateDriver({
			timeout: config.codeModeTimeout,
			memoryLimit: config.codeModeMemoryLimit,
		});
	}
	return createQuickJSBunIsolateDriver({
		timeout: config.codeModeTimeout,
		memoryLimit: config.codeModeMemoryLimit,
		maxStackSize: config.codeModeMaxStackSize,
		maxToolCalls: config.codeModeMaxToolCalls,
	});
}

function describeError(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return String(error);
}

export class Agent {
	private readonly adapter;
	private readonly codeMode;
	private readonly codeModeTools;
	private readonly codeModeSystemPrompt: string;
	private readonly model: string;

	public constructor(
		config: AppConfig,
		private readonly tools: ToolRegistry,
		private readonly logger: Logger,
		private readonly observability: PostHogObservability,
		private readonly approvals: ApprovalManager,
	) {
		this.model = config.openAiModel;
		this.adapter = openaiCompatibleText(config.openAiModel, {
			baseURL: config.openAiBaseUrl,
			apiKey: config.openAiApiKey,
		});
		this.codeMode = createCodeMode({
			driver: createIsolateDriver(config, logger),
			tools: [...this.tools.all()],
			lazyToolsConfig: { includeDescription: "first-sentence" },
			timeout: config.codeModeTimeout,
			memoryLimit: config.codeModeMemoryLimit,
		});
		this.codeModeTools = this.codeMode.tools;
		this.codeModeSystemPrompt = this.codeMode.systemPrompt;
	}

	public async respond(context: ConversationContext, maxAgentIterations: number): Promise<string> {
		return discordContextStorage.run(context, () =>
			this.approvals.run(context, async () => {
				const runId = crypto.randomUUID();
				const distinctId = `discord:${context.authorId}`;
				const sessionId = `discord:${context.guildId ?? "dm"}:${context.channelId}`;
				const startedAt = Date.now();
				this.observability.captureAiStarted(runId, {
					distinctId,
					model: this.model,
					provider: "openai-compatible",
					guildId: context.guildId,
					channelId: context.channelId,
					sessionId,
					intent: context.content,
					input: context.content,
					toolCount: this.codeModeTools.length,
				});
				try {
					const stream = chat({
						adapter: this.adapter,
						messages: [
							...(context.history ?? []).map(formatHistoryMessage),
							{ role: "user" as const, content: formatDiscordRequest(context) },
						],
						systemPrompts: [
							SYSTEM_PROMPT,
							...(context.isFollowUp
								? ["Ce message est un follow-up dans une discussion active."]
								: []),
							this.codeModeSystemPrompt,
						],
						tools: [...this.codeModeTools],
						context,
						agentLoopStrategy: maxIterations(maxAgentIterations),
					});
					const observed = await this.observability.observeAiStream(stream, runId, distinctId, {
						sessionId,
						model: this.model,
						intent: context.content,
					});
					const response = observed.response.trim()
						? observed.response
						: [
								"Je n'ai pas pu produire une réponse textuelle.",
								observed.finishReason
									? `La génération s'est terminée avec le motif « ${observed.finishReason} ».`
									: "La génération s'est terminée sans motif communiqué.",
								observed.toolCalls.length
									? `Tools exécutés : ${observed.toolCalls.join(", ")}.`
									: "Aucun tool n'a été exécuté.",
								"Consulte les détails techniques ou réessaie avec une demande plus précise.",
							].join(" ");
					this.observability.captureAiCompleted(runId, distinctId, {
						duration_ms: Date.now() - startedAt,
						response_chars: response.length,
						response,
						input: context.content,
						model: this.model,
						session_id: sessionId,
						channel_id: context.channelId,
						finish_reason: observed.finishReason,
						tool_calls: observed.toolCalls,
					});
					return response;
				} catch (error) {
					this.logger.error("Échec de l'exécution TanStack AI", { error: String(error) });
					this.observability.captureAiFailed(runId, distinctId, error, {
						model: this.model,
						session_id: sessionId,
						duration_ms: Date.now() - startedAt,
					});
					return [
						"Je n'ai pas pu traiter la demande.",
						`Détail de l'erreur : ${describeError(error)}.`,
						"Aucune réponse fiable n'a été envoyée ; tu peux réessayer ou reformuler la demande.",
					].join(" ");
				}
			}),
		);
	}
}
