import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { getRecentLogs } from "../observability/logger";
import { getToolContext, requireChannel, requireClient, requireGuild } from "./discord-runtime";
import { channelSummary, memberSummary, messageSummary, roleSummary } from "./discord-helpers";

type Exec = { context?: ConversationContext };
const anyResult = z.any();
const id = z.string().min(1);
const dbPath =
	Bun.env.OPERATIONS_DATABASE_PATH ?? Bun.env.SESSION_DATABASE_PATH ?? "./data/sessions.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath, { create: true, readwrite: true });
db.run(
	`CREATE TABLE IF NOT EXISTS discord_operations (id TEXT PRIMARY KEY, guild_id TEXT, channel_id TEXT, action TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
);
db.run(
	`CREATE TABLE IF NOT EXISTS discord_scheduled_actions (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, content TEXT NOT NULL, execute_at INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL)`,
);
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const schedule = toolDefinition({
	name: "schedule_persistent_action",
	description: "Programme un message Discord persistant dans SQLite.",
	inputSchema: z.object({
		channelId: id,
		content: z.string().min(1).max(2_000),
		delaySeconds: z.number().int().min(1).max(2_592_000),
	}),
	outputSchema: anyResult,
});
const listScheduled = toolDefinition({
	name: "list_scheduled_actions",
	description: "Liste les actions Discord programmées et leur état.",
	inputSchema: z.object({ status: z.enum(["pending", "sent", "failed", "all"]).default("all") }),
	outputSchema: anyResult,
});
const cancelScheduled = toolDefinition({
	name: "cancel_persistent_action",
	description: "Annule une action Discord programmée.",
	inputSchema: z.object({ id, approvalToken: z.string().optional() }),
	outputSchema: anyResult,
});
const planBulk = toolDefinition({
	name: "plan_bulk_action",
	description: "Construit un plan détaillé d'action groupée sans mutation.",
	inputSchema: z.object({
		action: id,
		targetIds: z.array(id).min(1).max(1_000),
		guildId: id.optional(),
	}),
	outputSchema: anyResult,
});
const startOperation = toolDefinition({
	name: "start_operation",
	description: "Enregistre une opération longue et retourne son identifiant de suivi.",
	inputSchema: z.object({
		action: id,
		payload: z.record(z.string(), z.any()),
		guildId: id.optional(),
		channelId: id.optional(),
	}),
	outputSchema: anyResult,
});
const operationStatus = toolDefinition({
	name: "get_operation_status",
	description: "Retourne l'état d'une opération suivie.",
	inputSchema: z.object({ operationId: id }),
	outputSchema: anyResult,
});
const updateOperation = toolDefinition({
	name: "update_operation_status",
	description: "Met à jour l'état et le résultat d'une opération suivie.",
	inputSchema: z.object({
		operationId: id,
		status: z.enum(["pending", "running", "completed", "failed"]),
		result: z.any().optional(),
	}),
	outputSchema: anyResult,
});
const searchHistory = toolDefinition({
	name: "search_message_history",
	description: "Recherche dans l'historique récent de plusieurs salons accessibles.",
	inputSchema: z.object({
		query: z.string().min(1).max(100),
		channelIds: z.array(id).max(20).optional(),
		limit: z.number().int().min(1).max(100).default(25),
	}),
	outputSchema: anyResult,
});
const permissionCheck = toolDefinition({
	name: "check_action_permissions",
	description: "Prévalide les permissions du bot dans un salon avant une action.",
	inputSchema: z.object({ channelId: id, permissions: z.array(id).min(1) }),
	outputSchema: anyResult,
});
const resolveResource = toolDefinition({
	name: "resolve_discord_resource",
	description: "Résout une ressource Discord par identifiant, nom ou contexte courant.",
	inputSchema: z.object({
		resourceType: z.enum(["guild", "channel", "member", "role"]),
		query: z.string().min(1),
		guildId: id.optional(),
	}),
	outputSchema: anyResult,
});
const auditSearch = toolDefinition({
	name: "search_audit_log",
	description: "Recherche dans le journal d'audit Discord avec filtres.",
	inputSchema: z.object({
		guildId: id.optional(),
		userId: id.optional(),
		targetId: id.optional(),
		actionType: z.number().int().optional(),
		limit: z.number().int().min(1).max(100).default(25),
	}),
	outputSchema: anyResult,
});
const rateLimits = toolDefinition({
	name: "get_rate_limit_status",
	description: "Retourne l'état connu des limites REST Discord du client.",
	inputSchema: z.object({}),
	outputSchema: anyResult,
});
const recentFailures = toolDefinition({
	name: "get_recent_tool_failures",
	description: "Retourne les erreurs récentes capturées par le runtime.",
	inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(25) }),
	outputSchema: anyResult,
});
const simulate = toolDefinition({
	name: "simulate_discord_action",
	description: "Simule une action Discord sans appeler l'API ni modifier de ressource.",
	inputSchema: z.object({
		action: id,
		targetIds: z.array(id).min(1).max(1_000),
		reason: z.string().max(500).optional(),
	}),
	outputSchema: anyResult,
});

function operationRow(idValue: string) {
	return db.query("SELECT * FROM discord_operations WHERE id = ?").get(idValue) as Record<
		string,
		unknown
	> | null;
}

async function executeScheduled(idValue: string): Promise<void> {
	const row = db
		.query("SELECT * FROM discord_scheduled_actions WHERE id = ? AND status = 'pending'")
		.get(idValue) as { guild_id: string; channel_id: string; content: string } | null;
	if (!row) return;
	try {
		const guild = requireClient().guilds.cache.get(row.guild_id);
		if (!guild) throw new Error("Serveur Discord inaccessible.");
		const channel = guild.channels.cache.get(row.channel_id) as any;
		if (!channel?.isTextBased()) throw new Error("Salon textuel introuvable.");
		if (!("send" in channel)) throw new Error("Salon non textuel.");
		await channel.send({ content: row.content });
		db.run("UPDATE discord_scheduled_actions SET status = 'sent' WHERE id = ?", [idValue]);
	} catch {
		db.run("UPDATE discord_scheduled_actions SET status = 'failed' WHERE id = ?", [idValue]);
	} finally {
		timers.delete(idValue);
	}
}

export default [
	schedule.server(async ({ channelId, content, delaySeconds }, execution: Exec) => {
		const context = getToolContext(execution.context);
		const guild = requireGuild(context);
		const channel = requireChannel(guild, channelId);
		const actionId = crypto.randomUUID();
		const executeAt = Date.now() + delaySeconds * 1_000;
		db.run(
			"INSERT INTO discord_scheduled_actions (id, guild_id, channel_id, content, execute_at, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
			[actionId, guild.id, channel.id, content, executeAt, Date.now()],
		);
		timers.set(
			actionId,
			setTimeout(() => void executeScheduled(actionId), delaySeconds * 1_000),
		);
		return { scheduled: true, id: actionId, executeAt: new Date(executeAt).toISOString() };
	}),
	listScheduled.server(async ({ status }) => {
		const filter = status ?? "all";
		return {
			actions: db
				.query(
					filter === "all"
						? "SELECT * FROM discord_scheduled_actions ORDER BY execute_at ASC"
						: "SELECT * FROM discord_scheduled_actions WHERE status = ? ORDER BY execute_at ASC",
				)
				.all(...(filter === "all" ? [] : [filter])),
		};
	}),
	cancelScheduled.server(async ({ id: actionId }) => {
		const timer = timers.get(actionId);
		if (timer) clearTimeout(timer);
		timers.delete(actionId);
		const result = db.run(
			"UPDATE discord_scheduled_actions SET status = 'failed' WHERE id = ? AND status = 'pending'",
			[actionId],
		);
		return { cancelled: result.changes > 0, id: actionId };
	}),
	planBulk.server(async ({ action, targetIds, guildId }) => ({
		action,
		guildId: guildId ?? getToolContext()?.guildId ?? null,
		count: targetIds.length,
		targets: targetIds,
		requiresApproval: true,
	})),
	startOperation.server(async ({ action, payload, guildId, channelId }) => {
		const operationId = crypto.randomUUID();
		const now = Date.now();
		db.run(
			"INSERT INTO discord_operations (id, guild_id, channel_id, action, status, payload, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)",
			[
				operationId,
				guildId ?? getToolContext()?.guildId ?? null,
				channelId ?? getToolContext()?.channelId ?? null,
				action,
				JSON.stringify(payload),
				now,
				now,
			],
		);
		return { id: operationId, status: "pending" };
	}),
	operationStatus.server(async ({ operationId }) => {
		const row = operationRow(operationId);
		if (!row) throw new Error("Opération introuvable.");
		return row;
	}),
	updateOperation.server(async ({ operationId, status, result }) => {
		const update = db.run(
			"UPDATE discord_operations SET status = ?, result = ?, updated_at = ? WHERE id = ?",
			[status, result === undefined ? null : JSON.stringify(result), Date.now(), operationId],
		);
		if (!update.changes) throw new Error("Opération introuvable.");
		return operationRow(operationId);
	}),
	searchHistory.server(async ({ query, channelIds, limit }, execution: Exec) => {
		const max = limit ?? 25;
		const guild = requireGuild(execution.context);
		const channels =
			channelIds?.map((channelId) => requireChannel(guild, channelId) as any) ??
			[...guild.channels.cache.values()].filter((channel) => channel.isTextBased());
		const messages: unknown[] = [];
		for (const channel of channels) {
			if (!("messages" in channel)) continue;
			const fetched = await channel.messages.fetch({ limit: Math.min(max, 100) });
			messages.push(
				...[...fetched.values()]
					.filter((message: any) => message.content.toLowerCase().includes(query.toLowerCase()))
					.map(messageSummary),
			);
			if (messages.length >= max) break;
		}
		return { messages: messages.slice(0, max) };
	}),
	permissionCheck.server(async ({ channelId, permissions }, execution: Exec) => {
		const guild = requireGuild(execution.context);
		const channel = requireChannel(guild, channelId) as any;
		const me = await guild.members.fetchMe();
		const resolved = channel.permissionsFor(me);
		return {
			channelId,
			permissions: Object.fromEntries(
				permissions.map((permission) => [permission, Boolean(resolved?.has(permission as never))]),
			),
		};
	}),
	resolveResource.server(async ({ resourceType, query, guildId }, execution: Exec) => {
		const guild = requireGuild(execution.context, guildId);
		if (resourceType === "guild") return { resourceType, id: guild.id, name: guild.name };
		if (resourceType === "channel") {
			const channel =
				query === "current"
					? requireChannel(guild, "current")
					: (guild.channels.cache.get(query) ??
						[...guild.channels.cache.values()].find(
							(candidate) => "name" in candidate && candidate.name === query,
						));
			if (!channel) throw new Error("Salon introuvable.");
			return { resourceType, ...channelSummary(channel) };
		}
		if (resourceType === "role") {
			const role =
				guild.roles.cache.get(query) ??
				[...guild.roles.cache.values()].find((candidate) => candidate.name === query);
			if (!role) throw new Error("Rôle introuvable.");
			return { resourceType, ...roleSummary(role) };
		}
		const member = await guild.members
			.fetch(query)
			.catch(() =>
				[...guild.members.cache.values()].find((candidate) => candidate.user.username === query),
			);
		if (!member) throw new Error("Membre introuvable.");
		return { resourceType, ...memberSummary(member) };
	}),
	auditSearch.server(async ({ guildId, userId, targetId, actionType, limit }, execution: Exec) => {
		const logs = await requireGuild(execution.context, guildId).fetchAuditLogs({
			limit,
			type: actionType as any,
		});
		return {
			entries: [...logs.entries.values()]
				.filter(
					(entry: any) =>
						(!userId || entry.executorId === userId) && (!targetId || entry.targetId === targetId),
				)
				.map((entry: any) => ({
					id: entry.id,
					action: entry.action,
					executorId: entry.executorId,
					targetId: entry.targetId,
					reason: entry.reason,
					createdAt: entry.createdAt.toISOString(),
				})),
		};
	}),
	rateLimits.server(async () => {
		const rest = (requireClient() as any).rest;
		return {
			global: rest?.globalRemaining ?? null,
			hashes: rest?.handlers ? Object.keys(rest.handlers).length : null,
			note: "Les limites précises sont gérées par discord.js et peuvent varier par route.",
		};
	}),
	recentFailures.server(async ({ limit }) => ({ failures: getRecentLogs(limit ?? 25, "error") })),
	simulate.server(async ({ action, targetIds, reason }) => ({
		simulated: true,
		action,
		targets: targetIds,
		reason: reason ?? null,
		mutates: false,
		requiresApproval: true,
	})),
];
