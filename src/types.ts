import type {
  AutocompleteInteraction,
  ButtonInteraction,
  CacheType,
  ChatInputCommandInteraction,
  ClientEvents,
  Collection,
  ContextMenuCommandBuilder,
  ContextMenuCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import type { Agent } from "./agent/agent";
import type { Logger } from "./observability/logger";
import type { PostHogObservability } from "./observability/posthog";

export type SlashCommandBuilderLike =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder;

export interface SlashCommand {
  command: SlashCommandBuilderLike;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void> | void;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void> | void;
  cooldown?: number;
}

export interface ContextMenuCommand {
  command: ContextMenuCommandBuilder;
  execute: (interaction: ContextMenuCommandInteraction) => Promise<void> | void;
  cooldown?: number;
}

export interface ButtonCommand {
  prefix: string;
  execute: (interaction: ButtonInteraction) => Promise<void> | void;
  cooldown?: number;
}

export interface BotEvent<Name extends keyof ClientEvents = keyof ClientEvents> {
  name: Name;
  once?: boolean;
  execute: (...args: ClientEvents[Name]) => Promise<void> | void;
}

declare module "discord.js" {
  interface Client {
    commands: Collection<string, SlashCommand>;
    buttons: Collection<string, ButtonCommand>;
    contextMenus: Collection<string, ContextMenuCommand>;
    cooldowns: Collection<string, number>;
    agent: Agent;
    logger: Logger;
    observability: PostHogObservability;
  }
}
