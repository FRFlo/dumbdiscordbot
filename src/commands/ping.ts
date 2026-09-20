import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "../types";

const command: SlashCommand = {
  command: new SlashCommandBuilder().setName("ping").setDescription("Vérifie que le bot répond."),
  execute: async (interaction) => {
    await interaction.reply({ content: `Pong ! Latence : ${interaction.client.ws.ping} ms`, flags: MessageFlags.Ephemeral });
  },
};

export default command;
