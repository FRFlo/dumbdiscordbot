import type { Client } from "discord.js";
import { loadCommands } from "./handlers/command";
import { loadEvents } from "./handlers/event";
import { createDiscordClient } from "./client";
import type { AppConfig } from "../config";
import type { Agent } from "../agent/agent";
import type { Logger } from "../observability/logger";
import type { PostHogObservability } from "../observability/posthog";

export class DiscordAdapter {
  public readonly client: Client;
  private readonly config: AppConfig;

  public constructor(
    config: AppConfig,
    agent: Agent,
    logger: Logger,
    observability: PostHogObservability,
  ) {
    this.client = createDiscordClient(agent, logger, observability);
    this.config = config;
  }

  public async start(): Promise<void> {
    await loadEvents(this.client);
    await loadCommands(this.client, this.config);
    await this.client.login(this.config.discordToken);
  }
}
