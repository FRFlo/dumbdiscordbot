import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { Events, type Client, type ClientEvents } from "discord.js";
import { createQuickJSIsolateDriver } from "@tanstack/ai-isolate-quickjs";
import type { ToolBinding } from "@tanstack/ai-code-mode";
import type { Agent } from "../agent/agent";
import type { ConversationContext } from "../domain/types";

const databasePath =
	Bun.env.ECOSYSTEM_DATABASE_PATH ?? Bun.env.SESSION_DATABASE_PATH ?? "./data/sessions.sqlite";
mkdirSync(dirname(databasePath), { recursive: true });
const database = new Database(databasePath, { create: true, readwrite: true });
database.run(`CREATE TABLE IF NOT EXISTS ecosystem_event_addons (
	id TEXT PRIMARY KEY, name TEXT NOT NULL, event_name TEXT NOT NULL,
	guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, once INTEGER NOT NULL DEFAULT 0,
	action_type TEXT NOT NULL, prompt TEXT, script TEXT,
	max_agent_calls INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
	created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);

type ActionType = "invoke_agent" | "execute_script";
type AddonRow = {
	id: string;
	name: string;
	event_name: string;
	guild_id: string;
	channel_id: string;
	once: number;
	action_type: ActionType;
	prompt?: string | null;
	script?: string | null;
	max_agent_calls: number;
};

let client: Client | undefined;
let agent: Agent | undefined;
let maxAgentIterations = 5;
const listeners = new Map<string, { row: AddonRow; handler: (...args: unknown[]) => void }>();
const scriptDriver = createQuickJSIsolateDriver({ timeout: 10_000, memoryLimit: 32 });

export function isDiscordClientEvent(value: string): value is keyof ClientEvents {
	return Object.values(Events).includes(value as (typeof Events)[keyof typeof Events]);
}

function eventPayload(args: unknown[]): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(args, (_, value: unknown) => {
		if (typeof value === "bigint") return String(value);
		if (typeof value === "function") return undefined;
		if (value && typeof value === "object") {
			if (seen.has(value)) return "[Circular]";
			seen.add(value);
			if (value instanceof Date) return value.toISOString();
			const entries = Object.entries(value as Record<string, unknown>).slice(0, 40);
			return Object.fromEntries(entries);
		}
		return value;
	});
}

async function sendMessage(row: AddonRow, content: string): Promise<void> {
	const channel = client?.channels.cache.get(row.channel_id) as any;
	if (!channel?.isTextBased() || !("send" in channel))
		throw new Error("Salon textuel introuvable.");
	await channel.send({ content: String(content).slice(0, 2_000) });
}

async function invokeAgent(row: AddonRow, prompt: string, payload: string): Promise<string> {
	if (!agent) throw new Error("Agent indisponible pour cet addon Discord.");
	const context: ConversationContext = {
		content: `${prompt}\n\nDonnées de l'événement Discord (JSON) :\n${payload}`,
		authorId: "discord-event-addon",
		authorName: `Addon ${row.name}`,
		guildId: row.guild_id,
		channelId: row.channel_id,
	};
	const response = await agent.respond(context, maxAgentIterations);
	await sendMessage(row, response);
	return response;
}

async function executeScript(row: AddonRow, script: string, payload: string): Promise<void> {
	let calls = 0;
	const bindings: Record<string, ToolBinding> = {
		send_message: {
			name: "send_message",
			description: "Envoie un message dans le salon configuré de l'addon.",
			inputSchema: {
				type: "object",
				properties: { content: { type: "string" } },
				required: ["content"],
			},
			execute: async (args) => {
				await sendMessage(row, String((args as { content: string }).content));
				return { sent: true };
			},
		},
		invoke_agent: {
			name: "invoke_agent",
			description: "Invoque l'agent avec un prompt dans la limite configurée.",
			inputSchema: {
				type: "object",
				properties: { prompt: { type: "string" } },
				required: ["prompt"],
			},
			execute: async (args) => {
				calls += 1;
				if (calls > row.max_agent_calls) throw new Error("Limite d'invocations agent dépassée.");
				return invokeAgent(row, String((args as { prompt: string }).prompt), payload);
			},
		},
		get_event_payload: {
			name: "get_event_payload",
			description: "Retourne les arguments de l'événement Discord au format JSON.",
			inputSchema: { type: "object" },
			execute: async () => payload,
		},
		get_current_time: {
			name: "get_current_time",
			description: "Retourne l'heure courante en ISO.",
			inputSchema: { type: "object" },
			execute: async () => new Date().toISOString(),
		},
	};
	const context = await scriptDriver.createContext({ bindings });
	try {
		const result = await context.execute(script);
		if (!result.success) throw new Error(result.error?.message ?? "Échec du script d'addon.");
	} finally {
		await context.dispose();
	}
}

async function execute(row: AddonRow, args: unknown[]): Promise<void> {
	const payload = eventPayload(args);
	if (row.action_type === "invoke_agent")
		await invokeAgent(row, row.prompt ?? "Analyse cet événement.", payload);
	else await executeScript(row, row.script ?? "", payload);
}

function attach(row: AddonRow): void {
	if (!client || !isDiscordClientEvent(row.event_name)) return;
	detach(row.id);
	const handler = (...args: unknown[]) =>
		void execute(row, args)
			.then(() => {
				if (row.once) setEventAddonStatus(row.id, "paused");
			})
			.catch((error) => {
				client?.logger.error("Erreur d'addon Discord", {
					addon: row.name,
					event: row.event_name,
					error: String(error),
				});
				client?.observability.captureError(error, { area: "discord.event_addon", addon: row.name });
			});
	if (row.once) client.once(row.event_name as never, handler as never);
	else client.on(row.event_name as never, handler as never);
	listeners.set(row.id, { row, handler });
	client.logger.debug("Addon Discord chargé", { addon: row.name, event: row.event_name });
}

function detach(id: string): void {
	const current = listeners.get(id);
	if (current && client) client.off(current.row.event_name as never, current.handler as never);
	listeners.delete(id);
}

export function createEventAddon(input: {
	name: string;
	eventName: string;
	guildId: string;
	channelId: string;
	once: boolean;
	actionType: ActionType;
	prompt?: string;
	script?: string;
	maxAgentCalls: number;
}): string {
	if (!isDiscordClientEvent(input.eventName))
		throw new Error(`Événement Discord inconnu : ${input.eventName}`);
	const id = crypto.randomUUID();
	const now = Date.now();
	database.run(
		"INSERT INTO ecosystem_event_addons (id, name, event_name, guild_id, channel_id, once, action_type, prompt, script, max_agent_calls, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)",
		[
			id,
			input.name,
			input.eventName,
			input.guildId,
			input.channelId,
			input.once ? 1 : 0,
			input.actionType,
			input.prompt ?? null,
			input.script ?? null,
			input.maxAgentCalls,
			now,
			now,
		],
	);
	if (client)
		attach({
			id,
			name: input.name,
			event_name: input.eventName,
			guild_id: input.guildId,
			channel_id: input.channelId,
			once: input.once ? 1 : 0,
			action_type: input.actionType,
			prompt: input.prompt,
			script: input.script,
			max_agent_calls: input.maxAgentCalls,
		});
	return id;
}

export function listEventAddons() {
	return database.query("SELECT * FROM ecosystem_event_addons ORDER BY created_at DESC").all();
}

export function setEventAddonStatus(id: string, status: "active" | "paused" | "deleted"): boolean {
	if (status !== "active") detach(id);
	const result = database.run(
		"UPDATE ecosystem_event_addons SET status = ?, updated_at = ? WHERE id = ?",
		[status, Date.now(), id],
	);
	if (status === "active" && result.changes && client) {
		const row = database
			.query("SELECT * FROM ecosystem_event_addons WHERE id = ?")
			.get(id) as AddonRow;
		attach(row);
	}
	return result.changes > 0;
}

export function startEventAddons(
	discordClient: Client,
	discordAgent: Agent,
	agentIterations = 5,
): void {
	client = discordClient;
	agent = discordAgent;
	maxAgentIterations = agentIterations;
	const rows = database
		.query("SELECT * FROM ecosystem_event_addons WHERE status = 'active'")
		.all() as AddonRow[];
	for (const row of rows) attach(row);
}

export function stopEventAddons(): void {
	for (const id of listeners.keys()) detach(id);
}
