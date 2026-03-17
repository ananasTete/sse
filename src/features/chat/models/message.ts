export type ChatRole = 'assistant' | 'system' | 'user'

export type ChatStatus = 'error' | 'ready' | 'streaming' | 'submitted'

export type ChatStopReason = 'end_turn' | 'stop_sequence' | 'user_canceled' | null

export interface ChatTextContent {
  citations: ChatCitation[]
  start_timestamp: string
  stop_timestamp: string | null
  text: string
  type: 'text'
}

export interface ChatCitationMetadata {
  favicon_url?: string
  site_domain?: string
  site_name?: string
  type?: string
}

export interface ChatCitationSource {
  icon_url: string | null
  source: string | null
  title: string | null
  url: string | null
  uuid: string
}

export interface ChatCitation {
  end_index: number
  metadata: ChatCitationMetadata | null
  origin_tool_name: string | null
  sources: ChatCitationSource[]
  start_index: number
  title: string | null
  url: string | null
  uuid: string
}

export interface ChatToolResultContent {
  display_content: unknown | null
  icon_name: string | null
  is_error: boolean
  message: string | null
  name: string
  start_timestamp: string
  stop_timestamp: string | null
  tool_use_id: string
  type: 'tool_result'
}

export interface ChatToolUseContent {
  display_content: unknown | null
  icon_name: string | null
  id: string
  input: Record<string, unknown> | null
  message: string | null
  name: string
  start_timestamp: string
  stop_timestamp: string | null
  tool_result: ChatToolResultContent | null
  type: 'tool_use'
}

export type ChatContent = ChatTextContent | ChatToolUseContent

export interface ChatMessageLimitWindow {
  resets_at: number | null
  status: string
  utilization: number | null
}

export interface ChatMessageLimit {
  overageDisabledReason: string | null
  overageInUse: boolean
  perModelLimit: number | null
  remaining: number | null
  representativeClaim: string | null
  resetsAt: string | number | null
  type: string
  windows: Record<string, ChatMessageLimitWindow>
}

export interface ChatMessageMetadata {
  message_limit?: ChatMessageLimit
}

export interface ChatMessage {
  content: ChatContent[]
  created_at: string
  // Only persisted file ids belong on the message model and completion payload.
  files: string[]
  index: number
  metadata: ChatMessageMetadata
  model: string
  parent_message_uuid: string
  role: ChatRole
  stop_reason: ChatStopReason
  updated_at: string
  uuid: string
}

export type NewChatMessage = Omit<ChatMessage, 'index'>
