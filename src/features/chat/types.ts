export type ChatRole = 'assistant' | 'system' | 'user'

export type ChatStatus = 'error' | 'ready' | 'streaming' | 'submitted'

export type ChatStopReason = 'end_turn' | 'stop_sequence' | 'user_canceled' | null

export type ChatTrigger = 'regenerate' | 'submit'

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
  attachments: unknown[]
  content: ChatContent[]
  created_at: string
  files: unknown[]
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

export interface SendMessageInput {
  attachments?: unknown[]
  files?: unknown[]
  model?: string
  parentMessageUuid?: string
  prompt: string
}

export interface EditUserMessageInput {
  model: string
  prompt: string
}

export interface RegenerateMessageInput {
  model?: string
  prompt?: string
}

export interface SubmitTurnMessageUuids {
  assistant_message_uuid: string
  user_message_uuid: string
}

export interface RegenerateTurnMessageUuids {
  assistant_message_uuid: string
}

export interface SubmitChatCompletionRequest {
  attachments: unknown[]
  files: unknown[]
  model: string
  parent_message_uuid: string
  prompt: string
  trigger: 'submit'
  turn_message_uuids: SubmitTurnMessageUuids
}

export interface RegenerateChatCompletionRequest {
  attachments: unknown[]
  files: unknown[]
  model: string
  parent_message_uuid: string
  prompt: string
  trigger: 'regenerate'
  turn_message_uuids: RegenerateTurnMessageUuids
}

export type ChatCompletionRequest =
  | RegenerateChatCompletionRequest
  | SubmitChatCompletionRequest

export interface ChatCompletionMessageStartEvent {
  message: {
    content: []
    id: string
    model: string
    parent_uuid: string
    role: 'assistant'
    stop_reason: null
    stop_sequence: string | null
    type: 'message'
    uuid: string
  }
  type: 'message_start'
}

export interface ChatCompletionContentBlockStartEvent {
  content_block:
    | {
        citations: ChatCitation[]
        flags: null
        start_timestamp: string
        stop_timestamp: null
        text: string
        type: 'text'
      }
    | {
        display_content: unknown | null
        flags: null
        icon_name: string | null
        id: string
        input: Record<string, unknown> | null
        message: string | null
        name: string
        start_timestamp: string
        stop_timestamp: null
        type: 'tool_use'
      }
    | {
        display_content: unknown | null
        flags: null
        icon_name: string | null
        is_error: boolean
        message: string | null
        name: string
        start_timestamp: string
        stop_timestamp: null
        tool_use_id: string
        type: 'tool_result'
      }
  index: number
  type: 'content_block_start'
}

export interface ChatCompletionContentBlockDeltaEvent {
  delta:
    | {
        text: string
        type: 'text_delta'
      }
    | {
        citation: Omit<ChatCitation, 'end_index' | 'start_index'>
        type: 'citation_start_delta'
      }
    | {
        citation_uuid: string
        type: 'citation_end_delta'
      }
    | {
        partial_json: string
        type: 'input_json_delta'
      }
    | {
        display_content: unknown | null
        message: string | null
        type: 'tool_use_block_update_delta'
      }
    | {
        display_content: unknown | null
        is_error?: boolean
        message: string | null
        type: 'tool_result_block_update_delta'
      }
  index: number
  type: 'content_block_delta'
}

export interface ChatCompletionContentBlockStopEvent {
  index: number
  stop_timestamp: string
  type: 'content_block_stop'
}

export interface ChatCompletionMessageDeltaEvent {
  delta: {
    stop_reason: Exclude<ChatStopReason, 'user_canceled' | null>
    stop_sequence: string | null
  }
  type: 'message_delta'
}

export interface ChatCompletionMessageStopEvent {
  type: 'message_stop'
}

export interface ChatCompletionMessageLimitEvent {
  message_limit: ChatMessageLimit
  type: 'message_limit'
}

export type ChatCompletionSseEvent =
  | ChatCompletionContentBlockDeltaEvent
  | ChatCompletionContentBlockStartEvent
  | ChatCompletionContentBlockStopEvent
  | ChatCompletionMessageLimitEvent
  | ChatCompletionMessageDeltaEvent
  | ChatCompletionMessageStartEvent
  | ChatCompletionMessageStopEvent
