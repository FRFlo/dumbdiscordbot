import { z } from "zod";

const embedAsset = z.object({
	url: z.string().url(),
	proxy_url: z.string().url().optional(),
	height: z.number().int().nonnegative().optional(),
	width: z.number().int().nonnegative().optional(),
});

const embed = z.object({
	title: z.string().max(256).optional(),
	type: z.string().optional(),
	description: z.string().max(4_096).optional(),
	url: z.string().url().optional(),
	timestamp: z.string().datetime({ offset: true }).optional(),
	color: z.number().int().min(0).max(0xffffff).optional(),
	footer: z
		.object({ text: z.string().max(2_048), icon_url: z.string().url().optional() })
		.optional(),
	image: embedAsset.optional(),
	thumbnail: embedAsset.optional(),
	author: z
		.object({
			name: z.string().max(256),
			url: z.string().url().optional(),
			icon_url: z.string().url().optional(),
		})
		.optional(),
	fields: z
		.array(
			z.object({
				name: z.string().max(256),
				value: z.string().max(1_024),
				inline: z.boolean().optional(),
			}),
		)
		.max(25)
		.optional(),
});

/**
 * JSON-compatible subset of discord.js message options exposed to the agent.
 * Components and polls are intentionally open so Discord can evolve without
 * requiring a bot release for every new component type.
 */
export const messageContent = z
	.object({
		content: z.string().max(2_000).optional(),
		embeds: z.array(embed).max(10).optional(),
		components: z.array(z.record(z.string(), z.unknown())).max(5).optional(),
		files: z.array(z.string().url()).max(10).optional(),
		allowedMentions: z
			.object({
				parse: z.array(z.enum(["roles", "users", "everyone"])).optional(),
				users: z.array(z.string()).max(100).optional(),
				roles: z.array(z.string()).max(100).optional(),
				repliedUser: z.boolean().optional(),
			})
			.optional(),
		poll: z.record(z.string(), z.unknown()).optional(),
		tts: z.boolean().optional(),
	})
	.refine(
		(value) =>
			Boolean(
				value.content ||
				value.embeds?.length ||
				value.components?.length ||
				value.files?.length ||
				value.poll,
			),
		{
			message:
				"Un message doit contenir du texte, un embed, un composant, un fichier ou un sondage.",
		},
	);

export type MessageContent = z.infer<typeof messageContent>;
