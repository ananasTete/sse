import type { ChatState } from '../state/chat-state'

export interface ChatConversationSummary {
  created_at: string
  current_leaf_message_uuid: string | null
  title: string
  updated_at: string
  uuid: string
}

export interface ChatConversationDetail extends ChatConversationSummary {
  mapping: ChatState['mapping']
}

export interface ChatConversationListResponse {
  has_more: boolean
  items: ChatConversationSummary[]
  next_cursor: string | null
}

export interface CreateChatConversationInput {
  uuid: string
}

export interface PendingInitialConversationSubmission {
  model: string
  prompt: string
}
