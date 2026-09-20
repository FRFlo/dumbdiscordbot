import type { Client } from "discord.js";
import type { BotEvent } from "../types";

const event: BotEvent<"clientReady"> = {
	name: "clientReady",
	once: true,
	execute: (client: Client<true>) =>
		client.logger.info("Bot Discord connecté", { user: client.user.tag }),
};

export default event;
