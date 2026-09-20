import type { Interaction } from "discord.js";
import type { BotEvent } from "../types";

const event: BotEvent<"interactionCreate"> = {
  name: "interactionCreate",
  execute: async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: "Commande inconnue.", ephemeral: true });
      return;
    }
    try {
      await command.execute(interaction);
    } catch (error) {
      interaction.client.logger.error("Erreur de commande", { command: interaction.commandName, error: String(error) });
      interaction.client.observability.captureError(error, {
        area: "discord.command",
        command: interaction.commandName,
        distinct_id: `discord:${interaction.user.id}`,
      });
      if (interaction.replied || interaction.deferred) await interaction.editReply("Une erreur est survenue.");
      else await interaction.reply({ content: "Une erreur est survenue.", ephemeral: true });
    }
  },
};

export default event;
