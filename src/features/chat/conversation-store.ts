import { ROOT_PARENT_MESSAGE_UUID } from './constants'
import type {
  ChatConversationDetail,
  ChatConversationListResponse,
  ChatConversationSummary,
} from './conversation-model'
import type { ChatState } from './state'

const DEFAULT_PAGE_SIZE = 20

interface ConversationStore {
  conversations: Map<string, ChatConversationDetail>
}

declare global {
  var __mockConversationStore: ConversationStore | undefined
}

function createEmptyMapping(): ChatState['mapping'] {
  return {
    [ROOT_PARENT_MESSAGE_UUID]: {
      child_uuids: [],
      message: null,
      parent_uuid: null,
      uuid: ROOT_PARENT_MESSAGE_UUID,
    },
  }
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

function getStore() {
  globalThis.__mockConversationStore ??= {
    conversations: new Map(),
  }

  return globalThis.__mockConversationStore
}

function toSummary(
  conversation: ChatConversationDetail,
): ChatConversationSummary {
  const { mapping: _mapping, ...summary } = conversation

  return summary
}

function sortConversations(conversations: Iterable<ChatConversationDetail>) {
  return [...conversations].sort((left, right) => {
    if (left.updated_at !== right.updated_at) {
      return right.updated_at.localeCompare(left.updated_at)
    }

    if (left.created_at !== right.created_at) {
      return right.created_at.localeCompare(left.created_at)
    }

    return right.uuid.localeCompare(left.uuid)
  })
}

function encodeCursor(conversation: ChatConversationSummary) {
  return Buffer.from(
    JSON.stringify({
      updated_at: conversation.updated_at,
      uuid: conversation.uuid,
    }),
    'utf-8',
  ).toString('base64')
}

function decodeCursor(cursor: string) {
  try {
    return JSON.parse(
      Buffer.from(cursor, 'base64').toString('utf-8'),
    ) as {
      updated_at: string
      uuid: string
    }
  } catch {
    return null
  }
}

export function createConversation(uuid: string) {
  const store = getStore()

  if (store.conversations.has(uuid)) {
    throw new Error('Conversation already exists.')
  }

  const timestamp = new Date().toISOString()
  const conversation: ChatConversationDetail = {
    created_at: timestamp,
    current_leaf_message_uuid: null,
    mapping: createEmptyMapping(),
    title: 'New conversation',
    updated_at: timestamp,
    uuid,
  }

  store.conversations.set(uuid, conversation)

  return cloneValue(conversation)
}

export function getConversation(uuid: string) {
  const conversation = getStore().conversations.get(uuid)

  return conversation ? cloneValue(conversation) : null
}

export function mutateConversation<T>(
  uuid: string,
  updater: (conversation: ChatConversationDetail) => T,
) {
  const conversation = getStore().conversations.get(uuid)

  if (!conversation) {
    throw new Error('Conversation not found.')
  }

  const result = updater(conversation)
  return cloneValue(result)
}

export function listConversations({
  cursor,
  limit = DEFAULT_PAGE_SIZE,
}: {
  cursor: string | null
  limit?: number
}): ChatConversationListResponse {
  const summaries = sortConversations(getStore().conversations.values()).map(
    toSummary,
  )
  const decodedCursor = cursor ? decodeCursor(cursor) : null
  const startIndex = decodedCursor
    ? summaries.findIndex(
        (conversation) =>
          conversation.uuid === decodedCursor.uuid &&
          conversation.updated_at === decodedCursor.updated_at,
      ) + 1
    : 0
  const pageItems = summaries.slice(
    Math.max(startIndex, 0),
    Math.max(startIndex, 0) + limit,
  )
  const hasMore = Math.max(startIndex, 0) + pageItems.length < summaries.length

  return {
    has_more: hasMore,
    items: cloneValue(pageItems),
    next_cursor:
      hasMore && pageItems.length > 0
        ? encodeCursor(pageItems[pageItems.length - 1]!)
        : null,
  }
}

export function updateConversationSummaryFields(
  conversation: ChatConversationDetail,
  {
    currentLeafMessageUuid,
    prompt,
    updatedAt,
  }: {
    currentLeafMessageUuid: string | null
    prompt?: string
    updatedAt: string
  },
) {
  conversation.current_leaf_message_uuid = currentLeafMessageUuid
  conversation.updated_at = updatedAt

  if (
    conversation.title === 'New conversation' &&
    prompt &&
    prompt.trim().length > 0
  ) {
    conversation.title = prompt.trim().slice(0, 48)
  }
}
