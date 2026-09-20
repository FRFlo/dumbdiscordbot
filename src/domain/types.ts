export interface ConversationContext {
	content: string;
	authorId: string;
	authorName: string;
	guildId?: string;
	channelId: string;
	isFollowUp?: boolean;
	history?: readonly ConversationMessage[];
}

export interface ConversationMessage {
	role: "user" | "assistant";
	content: string;
}
