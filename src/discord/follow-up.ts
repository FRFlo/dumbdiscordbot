import type { ConversationMessage } from "../domain/types";

interface ConversationState {
  lastActivity: number;
  history: ConversationMessage[];
}

/** Maintient les conversations follow-up par utilisateur et canal. */
export class FollowUpState {
  private readonly conversations = new Map<string, ConversationState>();

  public constructor(private readonly timeoutMs: number) {}

  public begin(key: string, now = Date.now()): ConversationState {
    const state = { lastActivity: now, history: [] };
    this.conversations.set(key, state);
    return state;
  }

  public getActive(key: string, now = Date.now()): ConversationState | undefined {
    const state = this.conversations.get(key);
    if (!state || now - state.lastActivity > this.timeoutMs) {
      this.conversations.delete(key);
      return undefined;
    }
    return state;
  }

  public record(key: string, userContent: string, assistantContent: string, now = Date.now()): void {
    const state = this.getActive(key, now);
    if (!state) return;
    state.history.push({ role: "user", content: userContent }, { role: "assistant", content: assistantContent });
    state.lastActivity = now;
  }

  public clear(key: string): void {
    this.conversations.delete(key);
  }
}
