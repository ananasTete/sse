import { toChatTimestamp } from './time'
import type {
  ChatCompletionContentBlockStartEvent,
  ChatCompletionMessageStartEvent,
  ChatToolResultContent,
  ChatToolUseContent,
  NewChatMessage,
} from './types'

export function createUserMessage({
  attachments,
  files,
  model,
  parentMessageUuid,
  prompt,
  uuid,
}: {
  attachments: unknown[]
  files: unknown[]
  model: string
  parentMessageUuid: string
  prompt: string
  uuid: string
}) {
  const timestamp = toChatTimestamp()

  return {
    attachments,
    content: [
      {
        citations: [],
        start_timestamp: timestamp,
        stop_timestamp: timestamp,
        text: prompt,
        type: 'text',
      },
    ],
    created_at: timestamp,
    files,
    metadata: {},
    model,
    parent_message_uuid: parentMessageUuid,
    role: 'user',
    stop_reason: null,
    updated_at: timestamp,
    uuid,
  } satisfies NewChatMessage
}

export function createAssistantMessage(
  event: ChatCompletionMessageStartEvent,
) {
  const timestamp = toChatTimestamp()

  return {
    attachments: [],
    content: [],
    created_at: timestamp,
    files: [],
    metadata: {},
    model: event.message.model,
    parent_message_uuid: event.message.parent_uuid,
    role: 'assistant',
    stop_reason: event.message.stop_reason,
    updated_at: timestamp,
    uuid: event.message.uuid,
  } satisfies NewChatMessage
}

export function createContentBlock(event: ChatCompletionContentBlockStartEvent) {
  switch (event.content_block.type) {
    case 'text':
      return {
        citations: event.content_block.citations,
        start_timestamp: event.content_block.start_timestamp,
        stop_timestamp: event.content_block.stop_timestamp,
        text: event.content_block.text,
        type: event.content_block.type,
      } satisfies NewChatMessage['content'][number]

    case 'tool_use':
      return {
        display_content: event.content_block.display_content,
        icon_name: event.content_block.icon_name,
        id: event.content_block.id,
        input: event.content_block.input,
        message: event.content_block.message,
        name: event.content_block.name,
        start_timestamp: event.content_block.start_timestamp,
        stop_timestamp: event.content_block.stop_timestamp,
        tool_result: null,
        type: event.content_block.type,
      } satisfies ChatToolUseContent

    case 'tool_result':
      throw new Error('Tool result blocks must be attached to a tool_use block.')
  }
}

export function createToolResultBlock(
  event: ChatCompletionContentBlockStartEvent,
) {
  if (event.content_block.type !== 'tool_result') {
    throw new Error('Expected a tool_result block.')
  }

  return {
    display_content: event.content_block.display_content,
    icon_name: event.content_block.icon_name,
    is_error: event.content_block.is_error,
    message: event.content_block.message,
    name: event.content_block.name,
    start_timestamp: event.content_block.start_timestamp,
    stop_timestamp: event.content_block.stop_timestamp,
    tool_use_id: event.content_block.tool_use_id,
    type: event.content_block.type,
  } satisfies ChatToolResultContent
}
