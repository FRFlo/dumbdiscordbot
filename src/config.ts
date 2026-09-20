export interface AppConfig {
  discordToken: string;
  discordClientId: string;
  discordGuildId?: string;
  openAiBaseUrl: string;
  openAiApiKey: string;
  openAiModel: string;
  logLevel: string;
  maxAgentIterations: number;
}

function required(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

export function loadConfig(): AppConfig {
  return {
    discordToken: required("DISCORD_TOKEN"),
    discordClientId: required("DISCORD_CLIENT_ID"),
    discordGuildId: Bun.env.DISCORD_GUILD_ID,
    openAiBaseUrl: Bun.env.OPENAI_BASE_URL ?? "http://127.0.0.1:11434/v1",
    openAiApiKey: Bun.env.OPENAI_API_KEY ?? "ollama",
    openAiModel: Bun.env.OPENAI_MODEL ?? "qwen3:latest",
    logLevel: Bun.env.LOG_LEVEL ?? "info",
    maxAgentIterations: Number(Bun.env.MAX_AGENT_ITERATIONS ?? 5),
  };
}
