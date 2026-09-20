import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { Client } from "discord.js";
import { createQuickJSIsolateDriver } from "@tanstack/ai-isolate-quickjs";
import type { ToolBinding } from "@tanstack/ai-code-mode";
import type { Agent } from "../agent/agent";
import type { ConversationContext } from "../domain/types";

const databasePath =
	Bun.env.ECOSYSTEM_DATABASE_PATH ?? Bun.env.SESSION_DATABASE_PATH ?? "./data/sessions.sqlite";
mkdirSync(dirname(databasePath), { recursive: true });
const database = new Database(databasePath, { create: true, readwrite: true });

database.run(`CREATE TABLE IF NOT EXISTS ecosystem_tasks (
	id TEXT PRIMARY KEY, kind TEXT NOT NULL, guild_id TEXT, channel_id TEXT,
	content TEXT NOT NULL, run_at INTEGER NOT NULL, status TEXT NOT NULL,
	created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
database.run(`CREATE TABLE IF NOT EXISTS ecosystem_cron_jobs (
	id TEXT PRIMARY KEY, name TEXT NOT NULL, expression TEXT NOT NULL,
	timezone TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
	action_type TEXT NOT NULL DEFAULT 'send_message', content TEXT NOT NULL DEFAULT '',
	prompt TEXT, script TEXT, max_agent_calls INTEGER NOT NULL DEFAULT 0,
	delay_seconds INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
for (const column of [
	"action_type TEXT NOT NULL DEFAULT 'send_message'",
	"prompt TEXT",
	"script TEXT",
	"max_agent_calls INTEGER NOT NULL DEFAULT 0",
]) {
	try {
		database.run(`ALTER TABLE ecosystem_cron_jobs ADD COLUMN ${column}`);
	} catch {}
}

let client: Client | undefined;
let agent: Agent | undefined;
let maxAgentIterations = 5;
const scriptDriver = createQuickJSIsolateDriver({ timeout: 10_000, memoryLimit: 32 });
const taskJobs = new Map<string, Bun.CronJob>();
const cronJobs = new Map<string, Bun.CronJob>();

function utcExpression(timestamp: number): string {
	const date = new Date(timestamp);
	return `${date.getUTCMinutes()} ${date.getUTCHours()} ${date.getUTCDate()} ${date.getUTCMonth() + 1} *`;
}

async function sendMessage(guildId: string, channelId: string, content: string): Promise<void> {
	const guild = client?.guilds.cache.get(guildId);
	if (!guild) throw new Error("Serveur Discord inaccessible.");
	const channel = guild.channels.cache.get(channelId) as any;
	if (!channel?.isTextBased() || !("send" in channel))
		throw new Error("Salon textuel introuvable.");
	await channel.send({ content });
}

async function invokeAgent(guildId: string, channelId: string, prompt: string): Promise<string> {
	if (!agent) throw new Error("Agent indisponible pour cette tâche cron.");
	const context: ConversationContext = {
		content: prompt,
		authorId: "cron",
		authorName: "Cron scheduler",
		guildId,
		channelId,
	};
	const response = await agent.respond(context, maxAgentIterations);
	await sendMessage(guildId, channelId, response);
	return response;
}

async function executeScript(
	guildId: string,
	channelId: string,
	script: string,
	maxCalls: number,
): Promise<void> {
	let calls = 0;
	const bindings: Record<string, ToolBinding> = {
		send_message: {
			name: "send_message",
			description: "Envoie un message dans le salon du cron.",
			inputSchema: {
				type: "object",
				properties: { content: { type: "string" } },
				required: ["content"],
			},
			execute: async (args) => {
				const { content } = args as { content: string };
				await sendMessage(guildId, channelId, String(content));
				return { sent: true };
			},
		},
		invoke_agent: {
			name: "invoke_agent",
			description: "Invoque l'agent avec un prompt, dans la limite autorisée.",
			inputSchema: {
				type: "object",
				properties: { prompt: { type: "string" } },
				required: ["prompt"],
			},
			execute: async (args) => {
				const { prompt } = args as { prompt: string };
				calls += 1;
				if (calls > maxCalls) throw new Error("Limite d'invocations agent dépassée.");
				return invokeAgent(guildId, channelId, String(prompt));
			},
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
		if (!result.success) throw new Error(result.error?.message ?? "Échec du script cron.");
	} finally {
		await context.dispose();
	}
}

async function executeTask(taskId: string): Promise<void> {
	const task = database
		.query("SELECT * FROM ecosystem_tasks WHERE id = ? AND status = 'pending'")
		.get(taskId) as { guild_id: string; channel_id: string; content: string } | null;
	if (!task) return;
	try {
		await sendMessage(task.guild_id, task.channel_id, task.content);
		database.run("UPDATE ecosystem_tasks SET status = 'completed', updated_at = ? WHERE id = ?", [
			Date.now(),
			taskId,
		]);
	} catch {
		database.run("UPDATE ecosystem_tasks SET status = 'failed', updated_at = ? WHERE id = ?", [
			Date.now(),
			taskId,
		]);
	} finally {
		const job = taskJobs.get(taskId);
		if (job) job.stop();
		taskJobs.delete(taskId);
	}
}

function armTask(taskId: string, runAt: number): void {
	if (runAt <= Date.now()) {
		void executeTask(taskId);
		return;
	}
	const job = Bun.cron(utcExpression(runAt), async function () {
		this.stop();
		await executeTask(taskId);
	});
	taskJobs.set(taskId, job);
}

function armCronJob(row: {
	id: string;
	expression: string;
	timezone: string;
	guild_id: string;
	channel_id: string;
	content: string;
	delay_seconds: number;
	action_type: string;
	prompt?: string | null;
	script?: string | null;
	max_agent_calls: number;
}): void {
	const job = Bun.cron(
		row.expression,
		async () => {
			const occurrence = Math.floor(Date.now() / 60_000) * 60_000;
			if (row.action_type === "invoke_agent") {
				await invokeAgent(row.guild_id, row.channel_id, row.prompt ?? row.content);
				return;
			}
			if (row.action_type === "execute_script") {
				await executeScript(row.guild_id, row.channel_id, row.script ?? "", row.max_agent_calls);
				return;
			}
			scheduleMessage({
				guildId: row.guild_id,
				channelId: row.channel_id,
				content: row.content,
				runAt: occurrence + row.delay_seconds * 1_000,
			});
		},
		{ tz: row.timezone },
	);
	cronJobs.set(row.id, job);
}

export function scheduleMessage(input: {
	guildId: string;
	channelId: string;
	content: string;
	runAt: number;
}): { id: string; runAt: number } {
	const id = crypto.randomUUID();
	const now = Date.now();
	database.run(
		"INSERT INTO ecosystem_tasks (id, kind, guild_id, channel_id, content, run_at, status, created_at, updated_at) VALUES (?, 'discord_message', ?, ?, ?, ?, 'pending', ?, ?)",
		[id, input.guildId, input.channelId, input.content, input.runAt, now, now],
	);
	if (client) armTask(id, input.runAt);
	return { id, runAt: input.runAt };
}

export function listTasks(status = "all") {
	return database
		.query(
			status === "all"
				? "SELECT * FROM ecosystem_tasks ORDER BY run_at ASC"
				: "SELECT * FROM ecosystem_tasks WHERE status = ? ORDER BY run_at ASC",
		)
		.all(...(status === "all" ? [] : [status]));
}

export function cancelTask(id: string): boolean {
	const job = taskJobs.get(id);
	if (job) job.stop();
	taskJobs.delete(id);
	return (
		database.run(
			"UPDATE ecosystem_tasks SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'",
			[Date.now(), id],
		).changes > 0
	);
}

export function createCronJob(input: {
	name: string;
	expression: string;
	timezone: string;
	guildId: string;
	channelId: string;
	content: string;
	delaySeconds: number;
	actionType: "send_message" | "invoke_agent" | "execute_script";
	prompt?: string;
	script?: string;
	maxAgentCalls: number;
}): string {
	Bun.cron.parse(input.expression, Date.now(), { tz: input.timezone });
	const id = crypto.randomUUID();
	const now = Date.now();
	database.run(
		"INSERT INTO ecosystem_cron_jobs (id, name, expression, timezone, guild_id, channel_id, action_type, content, prompt, script, max_agent_calls, delay_seconds, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)",
		[
			id,
			input.name,
			input.expression,
			input.timezone,
			input.guildId,
			input.channelId,
			input.actionType,
			input.content,
			input.prompt ?? null,
			input.script ?? null,
			input.maxAgentCalls,
			input.delaySeconds,
			now,
			now,
		],
	);
	if (client)
		armCronJob({
			id,
			expression: input.expression,
			timezone: input.timezone,
			guild_id: input.guildId,
			channel_id: input.channelId,
			content: input.content,
			delay_seconds: input.delaySeconds,
			action_type: input.actionType,
			prompt: input.prompt,
			script: input.script,
			max_agent_calls: input.maxAgentCalls,
		});
	return id;
}

export function listCronJobs() {
	return database.query("SELECT * FROM ecosystem_cron_jobs ORDER BY created_at DESC").all();
}

export function setCronStatus(id: string, status: "active" | "paused" | "deleted"): boolean {
	if (status !== "active") {
		const job = cronJobs.get(id);
		if (job) job.stop();
		cronJobs.delete(id);
	}
	const result = database.run(
		"UPDATE ecosystem_cron_jobs SET status = ?, updated_at = ? WHERE id = ?",
		[status, Date.now(), id],
	);
	if (status === "active" && result.changes) {
		const row = database.query("SELECT * FROM ecosystem_cron_jobs WHERE id = ?").get(id) as any;
		armCronJob(row);
	}
	return result.changes > 0;
}

export function startScheduler(
	discordClient: Client,
	discordAgent: Agent,
	agentIterations = 5,
): void {
	client = discordClient;
	agent = discordAgent;
	maxAgentIterations = agentIterations;
	const pending = database
		.query("SELECT id, run_at FROM ecosystem_tasks WHERE status = 'pending'")
		.all() as Array<{ id: string; run_at: number }>;
	for (const task of pending) armTask(task.id, task.run_at);
	const jobs = database
		.query("SELECT * FROM ecosystem_cron_jobs WHERE status = 'active'")
		.all() as any[];
	for (const job of jobs) armCronJob(job);
}

export function stopScheduler(): void {
	for (const job of taskJobs.values()) job.stop();
	for (const job of cronJobs.values()) job.stop();
	taskJobs.clear();
	cronJobs.clear();
}
