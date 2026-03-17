import type { ChatMessage } from './message'

export interface ConversationNode {
  child_uuids: string[];
  message: ChatMessage | null;
  parent_uuid: string | null;
  uuid: string;
}

export type ConversationMapping = Record<string, ConversationNode>;
