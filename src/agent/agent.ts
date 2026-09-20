import { chat, maxIterations } from "@tanstack/ai";
import { createCodeMode, type IsolateDriver, type ToolBinding } from "@tanstack/ai-code-mode";
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

const SYSTEM_PROMPT = [
	"Tu es un assistant Discord utile et prudent.",
	"Utilise les tools disponibles uniquement quand ils sont nécessaires.",
	"Respecte toujours le contexte Discord et les permissions de l'utilisateur.",
	"Réponds toujours à la requête, y compris après l'utilisation de tools, en indiquant clairement et brièvement ce que tu as fait et le résultat obtenu.",
	"Dans execute_typescript, pour une opération ultra sensible ou une séquence liée, appelle approval({ description, actions: [{ action, targetIds }], timeoutMs? }) une seule fois avec toutes les actions et les listes exactes de cibles. Décris clairement toute la séquence à l'utilisateur. Si approved est vrai, transmets approvalToken: token à chaque tool sensible correspondant. Les tools destructifs refusent toute action ou cible absente de ce jeton. Les lectures et actions réversibles usuelles ne demandent pas d'approbation.",
].join(" ");

function exposeLocalApproval(driver: IsolateDriver): IsolateDriver {
	return {
		createContext: async (config) => {
			const bindings: Record<string, ToolBinding> = {};
			for (const [bindingName, binding] of Object.entries(config.bindings)) {
				const localName = bindingName.startsWith("external_")
					? bindingName.slice("external_".length)
					: bindingName;
				if (bindings[localName])
					throw new Error(`Nom de binding Code Mode dupliqué : ${localName}`);
				bindings[localName] = { ...binding, name: localName };
			}
			return driver.createContext({
				...config,
				bindings,
			});
		},
	};
}

function removeExternalPrefix(value: string): string {
	return value.replaceAll("external_", "");
}

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
			driver: exposeLocalApproval(createIsolateDriver(config, logger)),
			tools: [...this.tools.all()],
			timeout: config.codeModeTimeout,
			memoryLimit: config.codeModeMemoryLimit,
		});
		this.codeModeTools = this.codeMode.tools.map((tool) => ({
			...tool,
			description: removeExternalPrefix(tool.description),
		}));
		this.codeModeSystemPrompt = removeExternalPrefix(this.codeMode.systemPrompt);
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
							...(context.history ?? []),
							{ role: "user" as const, content: `${context.authorName}: ${context.content}` },
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
					const response = observed.response || "Je n'ai pas de réponse à fournir.";
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
					return "Je n'ai pas pu traiter cette demande pour le moment.";
				}
			}),
		);
	}
}
