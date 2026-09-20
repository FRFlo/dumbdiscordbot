import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { ConversationContext } from "../domain/types";
import { approve, requireGuild } from "./discord-runtime";

type Exec = { context?: ConversationContext };
const eventOutput = z.any();
const list = toolDefinition({ name: "list_scheduled_events", description: "Liste les événements planifiés d'un serveur.", inputSchema: z.object({ guildId: z.string().optional() }), outputSchema: eventOutput });
const create = toolDefinition({ name: "create_scheduled_event", description: "Crée un événement Discord après approbation.", inputSchema: z.object({ name: z.string().min(1).max(100), description: z.string().max(1_000).optional(), startTime: z.string(), endTime: z.string().optional(), channelId: z.string().optional(), location: z.string().max(100).optional(), guildId: z.string().optional() }), outputSchema: eventOutput });
const edit = toolDefinition({ name: "edit_scheduled_event", description: "Modifie un événement Discord après approbation.", inputSchema: z.object({ eventId: z.string(), name: z.string().max(100).optional(), description: z.string().max(1_000).nullable().optional(), guildId: z.string().optional() }), outputSchema: eventOutput });
const remove = toolDefinition({ name: "delete_scheduled_event", description: "Supprime un événement Discord après approbation.", inputSchema: z.object({ eventId: z.string(), guildId: z.string().optional() }), outputSchema: z.object({ deleted: z.boolean(), id: z.string() }) });
const get = toolDefinition({ name: "get_scheduled_event", description: "Retourne un événement planifié.", inputSchema: z.object({ eventId: z.string(), guildId: z.string().optional() }), outputSchema: eventOutput });
const start = toolDefinition({ name: "start_event", description: "Démarre un événement après approbation.", inputSchema: z.object({ eventId: z.string(), guildId: z.string().optional() }), outputSchema: eventOutput });
const end = toolDefinition({ name: "end_event", description: "Termine un événement après approbation.", inputSchema: z.object({ eventId: z.string(), guildId: z.string().optional() }), outputSchema: eventOutput });

function serialize(event: { id: string; name: string; description: string | null; scheduledStartAt: Date | null; scheduledEndAt: Date | null; status: unknown }) { return { id: event.id, name: event.name, description: event.description, startTime: event.scheduledStartAt?.toISOString() ?? null, endTime: event.scheduledEndAt?.toISOString() ?? null, status: String(event.status) }; }

export default [
  list.server(async ({ guildId }, execution: Exec) => ({ events: [...(await requireGuild(execution.context, guildId).scheduledEvents.fetch()).values()].map(serialize) })),
  get.server(async ({ eventId, guildId }, execution: Exec) => serialize(await requireGuild(execution.context, guildId).scheduledEvents.fetch(eventId))),
  create.server(async ({ name, description, startTime, endTime, channelId, location, guildId }, execution: Exec) => { const guild = requireGuild(execution.context, guildId); const event = await guild.scheduledEvents.create({ name, description: description ?? undefined, scheduledStartTime: new Date(startTime), scheduledEndTime: endTime ? new Date(endTime) : undefined, privacyLevel: 2, entityType: channelId ? 2 : location ? 3 : 3, channel: channelId ?? undefined, entityMetadata: location ? { location } : undefined }); return serialize(event); }),
  edit.server(async ({ eventId, name, description, guildId }, execution: Exec) => { const event = await requireGuild(execution.context, guildId).scheduledEvents.fetch(eventId); return serialize(await event.edit({ name, description: description ?? undefined })); }),
  remove.server(async ({ eventId, guildId }, execution: Exec) => { await approve(`Supprimer l'événement ${eventId}`); const event = await requireGuild(execution.context, guildId).scheduledEvents.fetch(eventId); await event.delete(); return { deleted: true, id: eventId }; }),
  start.server(async ({ eventId, guildId }, execution: Exec) => { const event = await requireGuild(execution.context, guildId).scheduledEvents.fetch(eventId); return serialize(await event.setStatus(2)); }),
  end.server(async ({ eventId, guildId }, execution: Exec) => { const event = await requireGuild(execution.context, guildId).scheduledEvents.fetch(eventId); return serialize(await event.setStatus(3)); }),
];

