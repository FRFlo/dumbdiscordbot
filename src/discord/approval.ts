import { AsyncLocalStorage } from "node:async_hooks";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type Client,
  type Message,
} from "discord.js";
import type { ConversationContext } from "../domain/types";

const APPROVAL_PREFIX = "approval";

interface ApprovalScope {
  authorId: string;
  channelId: string;
  guildId?: string;
}

interface PendingApproval {
  authorId: string;
  channelId: string;
  timer: ReturnType<typeof setTimeout>;
  action: string;
  targetIds: readonly string[];
  guildId?: string;
  resolve: (result: ApprovalResult) => void;
  message?: Message;
}

export interface ApprovalResult {
  approved: boolean;
  token?: string;
}

interface ApprovedToken {
  authorId: string;
  channelId: string;
  guildId?: string;
  action: string;
  remainingTargets: Set<string>;
  timer: ReturnType<typeof setTimeout>;
}

/** Gère les validations courtes pendant une exécution Code Mode. */
export class ApprovalManager {
  private readonly scopes = new AsyncLocalStorage<ApprovalScope>();
  private readonly pending = new Map<string, PendingApproval>();
  private readonly approved = new Map<string, ApprovedToken>();
  private client?: Client;

  public constructor(private readonly defaultTimeoutMs: number, private readonly tokenTtlMs: number) {}

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

  public async request(description: string, action: string, targetIds: readonly string[], timeoutMs = this.defaultTimeoutMs): Promise<ApprovalResult> {
    const scope = this.scopes.getStore();
    if (!scope) throw new Error("approval() doit être appelé pendant une réponse Discord.");
    if (!this.client) throw new Error("Le client Discord n'est pas prêt pour les approbations.");

    const channel = await this.client.channels.fetch(scope.channelId);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      throw new Error("Le canal Discord courant ne permet pas d'envoyer une approbation.");
    }

    const id = crypto.randomUUID();
    const boundedTimeout = Math.max(1_000, Math.min(timeoutMs, this.defaultTimeoutMs));
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${APPROVAL_PREFIX}:approve:${id}`)
        .setLabel("Approuver")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${APPROVAL_PREFIX}:reject:${id}`)
        .setLabel("Refuser")
        .setStyle(ButtonStyle.Danger),
    );

    let pending!: PendingApproval;
    const result = new Promise<ApprovalResult>((resolve) => {
      pending = {
        authorId: scope.authorId,
        channelId: scope.channelId,
        action,
        targetIds,
        guildId: scope.guildId,
        resolve,
        timer: setTimeout(() => {
          this.pending.delete(id);
          resolve({ approved: false });
        }, boundedTimeout),
      };
      this.pending.set(id, pending);
    });

    try {
      pending.message = await channel.send({
        content: `<@${scope.authorId}> approbation requise : ${description}`,
        components: [row],
        allowedMentions: { users: [scope.authorId] },
      });
    } catch (error) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.resolve({ approved: false });
      throw error;
    }

    return result;
  }

  public async resolve(interaction: ButtonInteraction): Promise<void> {
    const [prefix, decision, id] = interaction.customId.split(":");
    const approvalId = prefix === APPROVAL_PREFIX ? id : undefined;
    const pending = approvalId ? this.pending.get(approvalId) : undefined;
    if (!pending) {
      await interaction.reply({ content: "Cette approbation est expirée.", ephemeral: true });
      return;
    }
    if (interaction.user.id !== pending.authorId) {
      await interaction.reply({ content: "Cette approbation ne vous est pas destinée.", ephemeral: true });
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(approvalId!);
    const approved = decision === "approve";
    await interaction.update({
      content: `${approved ? "✅ Approuvé" : "❌ Refusé"} — ${interaction.message.content}`,
      components: [],
    });
    if (!approved) {
      pending.resolve({ approved: false });
      return;
    }
    const token = crypto.randomUUID();
    const tokenTimer = setTimeout(() => this.approved.delete(token), this.tokenTtlMs);
    this.approved.set(token, {
      authorId: pending.authorId,
      channelId: pending.channelId,
      guildId: pending.guildId,
      action: pending.action,
      remainingTargets: new Set(pending.targetIds),
      timer: tokenTimer,
    });
    pending.resolve({ approved: true, token });
  }

  public consume(token: string, action: string, targetIds: readonly string[]): void {
    const scope = this.scopes.getStore();
    const approval = this.approved.get(token);
    if (!scope || !approval || approval.authorId !== scope.authorId || approval.channelId !== scope.channelId) {
      throw new Error("Jeton d'approbation invalide ou expiré.");
    }
    if (approval.guildId !== scope.guildId || approval.action !== action || targetIds.some((target) => !approval.remainingTargets.has(target))) {
      throw new Error("Le jeton d'approbation ne couvre pas cette action ou ces cibles.");
    }
    for (const target of targetIds) approval.remainingTargets.delete(target);
    if (approval.remainingTargets.size === 0) {
      clearTimeout(approval.timer);
      this.approved.delete(token);
    }
  }

  public close(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ approved: false });
      this.pending.delete(id);
    }
    for (const [token, approval] of this.approved) {
      clearTimeout(approval.timer);
      this.approved.delete(token);
    }
  }
}
