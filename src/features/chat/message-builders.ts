import { toChatTimestamp } from './time'
import type {
  ChatCompletionContentBlockStartEvent,
  ChatCompletionMessageStartEvent,
  NewChatMessage,
} from './types'

export function createUserMessage({
  attachments,
  files,
  parentMessageUuid,
  prompt,
  uuid,
}: {
  attachments: unknown[]
  files: unknown[]
  parentMessageUuid: string
  prompt: string
  uuid: string
}) {
  const timestamp = toChatTimestamp()

  return {
    attachments,
    content: [
      {
        start_timestamp: timestamp,
        stop_timestamp: timestamp,
        text: prompt,
        type: 'text',
      },
    ],
    created_at: timestamp,
    files,
    metadata: {},
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
    parent_message_uuid: event.message.parent_uuid,
    role: 'assistant',
    stop_reason: event.message.stop_reason,
    updated_at: timestamp,
    uuid: event.message.uuid,
  } satisfies NewChatMessage
}

export function createContentBlock(event: ChatCompletionContentBlockStartEvent) {
  return {
    start_timestamp: event.content_block.start_timestamp,
    stop_timestamp: event.content_block.stop_timestamp,
    text: event.content_block.text,
    type: event.content_block.type,
  } satisfies NewChatMessage['content'][number]
}
