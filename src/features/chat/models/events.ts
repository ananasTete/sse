import type {
  ChatCitation,
  ChatMessageLimit,
  ChatStopReason,
  NewChatMessage,
} from './message'

export interface ChatCompletionMessageStartEvent {
  message: {
    content: []
    created_at: string
    id: string
    model: string
    parent_uuid: string
    role: 'assistant'
    stop_reason: null
    stop_sequence: string | null
    type: 'message'
    updated_at: string
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
  content_block: {
    stop_timestamp: string
  }
  index: number
  type: 'content_block_stop'
}

export interface ChatCompletionMessageStopEvent {
  message: {
    stop_reason: Exclude<ChatStopReason, 'user_canceled' | null>
    stop_sequence: string | null
  }
  type: 'message_stop'
}

export interface ChatCompletionMessageLimitEvent {
  message_limit: ChatMessageLimit
  type: 'message_limit'
}

export interface ChatCompletionMessageSnapshotEvent {
  message: NewChatMessage
  type: 'message_snapshot'
}

export interface ChatCompletionTitleEvent {
  title: string
  type: 'title'
}

export type ChatCompletionSseEvent =
  | ChatCompletionContentBlockDeltaEvent
  | ChatCompletionContentBlockStartEvent
  | ChatCompletionContentBlockStopEvent
  | ChatCompletionMessageLimitEvent
  | ChatCompletionMessageSnapshotEvent
  | ChatCompletionMessageStartEvent
  | ChatCompletionMessageStopEvent
  | ChatCompletionTitleEvent
