export interface ConversationContext {
  content: string;
  authorId: string;
  authorName: string;
  guildId?: string;
  channelId: string;
}
