import { AsyncLocalStorage } from "node:async_hooks";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Client,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	type ButtonInteraction,
	type Message,
	type ModalSubmitInteraction,
} from "discord.js";
import type { ConversationContext } from "../domain/types";

const QUESTION_PREFIX = "question";
const MAX_TEXT_LENGTH = 1_000;

export interface QuestionOption {
	value: string;
	label: string;
	description?: string;
	tone?: "success" | "danger";
}

export type QuestionDefinition =
	| {
			type: "closed";
			question: string;
			options: [QuestionOption, QuestionOption];
			timeoutMs?: number;
	  }
	| {
			type: "single";
			question: string;
			options: QuestionOption[];
			allowOther?: boolean;
			timeoutMs?: number;
	  }
	| {
			type: "multiple";
			question: string;
			options: QuestionOption[];
			allowOther?: boolean;
			minSelections?: number;
			timeoutMs?: number;
	  }
	| {
			type: "free";
			question: string;
			placeholder?: string;
			timeoutMs?: number;
	  };

export type QuestionAnswer =
	| { type: "closed" | "single" | "free"; answered: true; value: string }
	| { type: "multiple"; answered: true; values: string[] }
	| { type: QuestionDefinition["type"]; answered: false };

interface QuestionScope {
	authorId: string;
	channelId: string;
	guildId?: string;
}

interface PendingQuestion {
	id: string;
	scope: QuestionScope;
	definition: QuestionDefinition;
	selected: Set<string>;
	resolve: (answer: QuestionAnswer) => void;
	timer: ReturnType<typeof setTimeout>;
	message?: Message;
}

export interface ApprovalAction {
	action: string;
	targetIds: readonly string[];
}

export interface ApprovalResult {
	approved: boolean;
	token?: string;
}

export function questionOptionButtonStyle(
	type: QuestionDefinition["type"],
	option: QuestionOption,
	index: number,
	selected: boolean,
): ButtonStyle {
	if (type === "closed") {
		if (option.tone === "danger" || index === 1) return ButtonStyle.Danger;
		return ButtonStyle.Success;
	}
	if (selected) return ButtonStyle.Success;
	return option.tone === "danger" ? ButtonStyle.Danger : ButtonStyle.Primary;
}

interface ApprovedToken {
	authorId: string;
	channelId: string;
	guildId?: string;
	remainingTargets: Map<string, Set<string>>;
	timer: ReturnType<typeof setTimeout>;
}

/** Gère les questions interactives et les jetons d'approbation Discord. */
export class QuestionManager {
	private readonly scopes = new AsyncLocalStorage<QuestionScope>();
	private readonly pending = new Map<string, PendingQuestion>();
	private readonly approved = new Map<string, ApprovedToken>();
	private client?: Client;

	public constructor(
		private readonly defaultTimeoutMs: number,
		private readonly tokenTtlMs: number,
	) {}

	public attachClient(client: Client): void {
		this.client = client;
	}

	public run<T>(context: ConversationContext, callback: () => Promise<T>): Promise<T> {
		return this.scopes.run(
			{
				authorId: context.authorId,
				channelId: context.channelId,
				guildId: context.guildId,
			},
			callback,
		);
	}

	public async ask(definition: QuestionDefinition): Promise<QuestionAnswer> {
		const scope = this.scopes.getStore();
		if (!scope) throw new Error("question() doit être appelé pendant une réponse Discord.");
		if (!this.client) throw new Error("Le client Discord n'est pas prêt pour les questions.");
		this.validate(definition);

		const channel = await this.client.channels.fetch(scope.channelId);
		if (!channel || !channel.isTextBased() || !("send" in channel)) {
			throw new Error("Le canal Discord courant ne permet pas de poser une question.");
		}

		const id = crypto.randomUUID();
		const timeoutMs = Math.max(
			1_000,
			Math.min(definition.timeoutMs ?? this.defaultTimeoutMs, this.defaultTimeoutMs),
		);
		let pending!: PendingQuestion;
		const answer = new Promise<QuestionAnswer>((resolve) => {
			pending = {
				id,
				scope,
				definition,
				selected: new Set(),
				resolve,
				timer: setTimeout(() => {
					this.pending.delete(id);
					resolve({ type: definition.type, answered: false });
				}, timeoutMs),
			};
			this.pending.set(id, pending);
		});

		try {
			pending.message = await channel.send({
				content: this.renderContent(pending),
				components: this.renderComponents(pending),
				allowedMentions: { parse: [] },
			});
		} catch (error) {
			this.cancelPending(id, { type: definition.type, answered: false });
			throw error;
		}
		return answer;
	}

	public async resolveButton(interaction: ButtonInteraction): Promise<void> {
		const [, id, action, rawIndex] = interaction.customId.split(":");
		const pending = id ? this.pending.get(id) : undefined;
		if (!id || !pending) {
			await interaction.reply({ content: "Cette question est expirée.", ephemeral: true });
			return;
		}
		if (!this.isAuthorized(interaction.user.id, interaction.channelId, pending.scope)) {
			await interaction.reply({
				content: "Cette question ne vous est pas destinée.",
				ephemeral: true,
			});
			return;
		}

		if (action === "cancel") {
			await interaction.update({
				content: `${pending.definition.question}\n\n❌ Question annulée.`,
				components: [],
			});
			this.cancelPending(id, { type: pending.definition.type, answered: false });
			return;
		}
		if (action === "other" || action === "free") {
			await interaction.showModal(this.createModal(id, pending.definition));
			return;
		}
		if (action === "submit" && pending.definition.type === "multiple") {
			const minimum = pending.definition.minSelections ?? 1;
			if (pending.selected.size < minimum) {
				await interaction.reply({
					content: `Sélectionnez au moins ${minimum} option${minimum > 1 ? "s" : ""}.`,
					ephemeral: true,
				});
				return;
			}
			await interaction.update({
				content: `${pending.definition.question}\n\n✅ ${[...pending.selected].join(", ")}`,
				components: [],
			});
			this.resolvePending(id, { type: "multiple", answered: true, values: [...pending.selected] });
			return;
		}
		const index = Number(rawIndex);
		const option = this.getOption(pending.definition, index);
		if (!option) {
			await interaction.reply({ content: "Cette option n'est plus disponible.", ephemeral: true });
			return;
		}

		if (pending.definition.type === "multiple") {
			if (pending.selected.has(option.value)) pending.selected.delete(option.value);
			else pending.selected.add(option.value);
			await interaction.update({
				content: this.renderContent(pending),
				components: this.renderComponents(pending),
			});
			return;
		}

		await interaction.update({
			content: `${pending.definition.question}\n\n✅ ${option.label}`,
			components: [],
		});
		this.resolvePending(id, this.answerForOption(pending.definition.type, option.value));
	}

	public async resolveModal(interaction: ModalSubmitInteraction): Promise<void> {
		const [, id] = interaction.customId.split(":");
		const pending = id ? this.pending.get(id) : undefined;
		if (!id || !pending) {
			await interaction.reply({ content: "Cette question est expirée.", ephemeral: true });
			return;
		}
		if (
			!interaction.channelId ||
			!this.isAuthorized(interaction.user.id, interaction.channelId, pending.scope)
		) {
			await interaction.reply({
				content: "Cette question ne vous est pas destinée.",
				ephemeral: true,
			});
			return;
		}
		const value = interaction.fields.getTextInputValue("answer").trim();
		if (!value || value.length > MAX_TEXT_LENGTH) {
			await interaction.reply({
				content: "La réponse doit contenir entre 1 et 1 000 caractères.",
				ephemeral: true,
			});
			return;
		}

		if (pending.definition.type === "multiple") {
			pending.selected.add(value);
			await interaction.reply({ content: "Réponse ajoutée.", ephemeral: true });
			await pending.message?.edit({
				content: this.renderContent(pending),
				components: this.renderComponents(pending),
			});
			return;
		}

		await interaction.reply({ content: "Réponse enregistrée.", ephemeral: true });
		await pending.message?.edit({
			content: `${pending.definition.question}\n\n✅ ${value}`,
			components: [],
		});
		this.resolvePending(id, { type: pending.definition.type, answered: true, value });
	}

	public async requestApproval(
		description: string,
		actions: readonly ApprovalAction[],
		timeoutMs?: number,
	): Promise<ApprovalResult> {
		if (actions.length === 0) throw new Error("Une approbation doit contenir au moins une action.");
		const scopeDescription = actions
			.map(({ action, targetIds }) => `- ${action} : ${targetIds.join(", ")}`)
			.join("\n");
		const answer = await this.ask({
			type: "closed",
			question: `${description}\n\nOpérations demandées :\n${scopeDescription}`,
			options: [
				{ value: "approve", label: "Approuver", tone: "success" },
				{ value: "reject", label: "Refuser", tone: "danger" },
			],
			timeoutMs,
		});
		if (answer.type !== "closed" || !answer.answered || answer.value !== "approve") {
			return { approved: false };
		}

		const scope = this.scopes.getStore();
		if (!scope) return { approved: false };
		const token = crypto.randomUUID();
		const timer = setTimeout(() => this.approved.delete(token), this.tokenTtlMs);
		this.approved.set(token, {
			authorId: scope.authorId,
			channelId: scope.channelId,
			guildId: scope.guildId,
			remainingTargets: new Map(
				actions.map(({ action, targetIds }) => [action, new Set(targetIds)]),
			),
			timer,
		});
		return { approved: true, token };
	}

	public consume(token: string, action: string, targetIds: readonly string[]): void {
		const scope = this.scopes.getStore();
		const approval = this.approved.get(token);
		if (
			!scope ||
			!approval ||
			approval.authorId !== scope.authorId ||
			approval.channelId !== scope.channelId ||
			approval.guildId !== scope.guildId
		) {
			throw new Error("Jeton d'approbation invalide ou expiré.");
		}
		const remainingTargets = approval.remainingTargets.get(action);
		if (!remainingTargets || targetIds.some((target) => !remainingTargets.has(target))) {
			throw new Error("Le jeton d'approbation ne couvre pas cette action ou ces cibles.");
		}
		for (const target of targetIds) remainingTargets.delete(target);
		if ([...approval.remainingTargets.values()].every((targets) => targets.size === 0)) {
			clearTimeout(approval.timer);
			this.approved.delete(token);
		}
	}

	public close(): void {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.resolve({ type: pending.definition.type, answered: false });
			this.pending.delete(id);
		}
		for (const [token, approval] of this.approved) {
			clearTimeout(approval.timer);
			this.approved.delete(token);
		}
	}

	private validate(definition: QuestionDefinition): void {
		if (!definition.question.trim() || definition.question.length > MAX_TEXT_LENGTH)
			throw new Error("La question doit contenir entre 1 et 1 000 caractères.");
		if (definition.type === "closed" && definition.options.length !== 2)
			throw new Error("Une question fermée doit proposer exactement deux options.");
		if (definition.type === "single" || definition.type === "multiple") {
			if (definition.options.length < 1 || definition.options.length > 20)
				throw new Error("Une question à choix doit proposer entre 1 et 20 options.");
			if (
				definition.type === "multiple" &&
				(definition.minSelections ?? 0) > definition.options.length
			)
				throw new Error("Le nombre minimal de choix dépasse le nombre d'options.");
		}
		const values =
			definition.type === "free" ? [] : definition.options.map((option) => option.value);
		if (new Set(values).size !== values.length || values.some((value) => !value.trim()))
			throw new Error("Les valeurs des options doivent être non vides et uniques.");
	}

	private isAuthorized(userId: string, channelId: string, scope: QuestionScope): boolean {
		return userId === scope.authorId && channelId === scope.channelId;
	}

	private getOption(definition: QuestionDefinition, index: number): QuestionOption | undefined {
		return definition.type === "free" ? undefined : definition.options[index];
	}

	private answerForOption(
		type: "closed" | "single" | "multiple" | "free",
		value: string,
	): QuestionAnswer {
		if (type === "multiple") return { type, answered: true, values: [value] };
		return { type, answered: true, value };
	}

	private createModal(id: string, definition: QuestionDefinition): ModalBuilder {
		const input = new TextInputBuilder()
			.setCustomId("answer")
			.setLabel(definition.type === "free" ? "Votre réponse" : "Autre réponse")
			.setStyle(TextInputStyle.Paragraph)
			.setRequired(true)
			.setMaxLength(MAX_TEXT_LENGTH);
		if (definition.type === "free" && definition.placeholder)
			input.setPlaceholder(definition.placeholder);
		return new ModalBuilder()
			.setCustomId(`${QUESTION_PREFIX}:${id}:modal`)
			.setTitle(definition.type === "free" ? "Répondre" : "Autre réponse")
			.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
	}

	private renderContent(pending: PendingQuestion): string {
		const { definition, selected } = pending;
		const lines = [definition.question];
		if (definition.type !== "free") {
			lines.push(
				...definition.options.map(
					(option) => `• ${option.label}${option.description ? ` — ${option.description}` : ""}`,
				),
			);
		}
		if (definition.type === "multiple" && selected.size > 0) {
			lines.push(`Sélection actuelle : ${[...selected].join(", ")}`);
		}
		return lines.join("\n");
	}

	private renderComponents(pending: PendingQuestion): ActionRowBuilder<ButtonBuilder>[] {
		const { definition, id, selected } = pending;
		if (definition.type === "free") {
			return [
				this.row([
					this.button(id, "free", "Répondre", ButtonStyle.Primary),
					this.button(id, "cancel", "Annuler", ButtonStyle.Danger),
				]),
			];
		}
		const buttons = definition.options.map((option, index) =>
			this.button(
				id,
				`choice:${index}`,
				`${definition.type === "multiple" && selected.has(option.value) ? "✅ " : ""}${option.label}`,
				this.optionStyle(definition, option, index, selected.has(option.value)),
			),
		);
		if (definition.type !== "closed" && definition.allowOther)
			buttons.push(this.button(id, "other", "Autre", ButtonStyle.Secondary));
		if (definition.type === "multiple") {
			const minimum = definition.minSelections ?? 1;
			buttons.push(
				this.button(id, "submit", "Valider", ButtonStyle.Success, selected.size < minimum),
			);
		}
		buttons.push(this.button(id, "cancel", "Annuler", ButtonStyle.Danger));
		const rows: ActionRowBuilder<ButtonBuilder>[] = [];
		for (let index = 0; index < buttons.length; index += 5)
			rows.push(this.row(buttons.slice(index, index + 5)));
		return rows;
	}

	private button(
		id: string,
		action: string,
		label: string,
		style: ButtonStyle,
		disabled = false,
	): ButtonBuilder {
		return new ButtonBuilder()
			.setCustomId(`${QUESTION_PREFIX}:${id}:${action}`)
			.setLabel(label.slice(0, 80))
			.setStyle(style)
			.setDisabled(disabled);
	}

	private optionStyle(
		definition: QuestionDefinition,
		option: QuestionOption,
		index: number,
		selected: boolean,
	): ButtonStyle {
		return questionOptionButtonStyle(definition.type, option, index, selected);
	}

	private row(buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
	}

	private resolvePending(id: string, answer: QuestionAnswer): void {
		const pending = this.pending.get(id);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.pending.delete(id);
		pending.resolve(answer);
	}

	private cancelPending(id: string, answer: QuestionAnswer): void {
		this.resolvePending(id, answer);
	}
}
