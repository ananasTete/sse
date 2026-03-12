import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { ROOT_PARENT_MESSAGE_UUID } from './constants'
import type {
  ChatConversationDetail,
  ChatConversationListResponse,
  ChatConversationSummary,
  CreateChatConversationInput,
} from './conversation-model'
import type { ChatState } from './state'

async function readJson<T>(response: Response) {
  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`

    try {
      const payload = (await response.json()) as { error?: string }

      if (payload.error) {
        message = payload.error
      }
    } catch {}

    throw new Error(message)
  }

  return (await response.json()) as T
}

export const conversationKeys = {
  all: ['chatConversations'] as const,
  detail: (conversationId: string) =>
    ['chatConversations', 'detail', conversationId] as const,
  list: () => ['chatConversations', 'list'] as const,
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

export function buildConversationTitleFromPrompt(prompt: string) {
  const normalizedPrompt = prompt.trim()

  return normalizedPrompt ? normalizedPrompt.slice(0, 48) : 'New conversation'
}

export function buildConversationDetailSnapshot({
  summary,
  title,
}: {
  summary: ChatConversationSummary
  title?: string
}): ChatConversationDetail {
  return {
    ...summary,
    mapping: createEmptyMapping(),
    title: title ?? summary.title,
  }
}

export function upsertConversationListCache(
  queryClient: QueryClient,
  summary: ChatConversationSummary,
) {
  queryClient.setQueryData<InfiniteData<ChatConversationListResponse, string | undefined> | undefined>(
    conversationKeys.list(),
    (current) => {
      if (!current) {
        return {
          pageParams: [undefined],
          pages: [
            {
              has_more: false,
              items: [summary],
              next_cursor: null,
            },
          ],
        }
      }

      const [firstPage, ...restPages] = current.pages

      if (!firstPage) {
        return current
      }

      return {
        ...current,
        pages: [
          {
            ...firstPage,
            items: [
              summary,
              ...firstPage.items.filter(
                (conversation) => conversation.uuid !== summary.uuid,
              ),
            ],
          },
          ...restPages,
        ],
      }
    },
  )
}

export async function createChatConversation(
  input: CreateChatConversationInput,
) {
  const response = await fetch('/api/chat_conversations', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  return readJson<ChatConversationSummary>(response)
}

export async function fetchChatConversationDetail(conversationId: string) {
  const response = await fetch(`/api/chat_conversations/${conversationId}`)

  return readJson<ChatConversationDetail>(response)
}

export async function fetchChatConversationList({
  cursor,
}: {
  cursor?: string
}) {
  const searchParams = new URLSearchParams()

  if (cursor) {
    searchParams.set('cursor', cursor)
  }

  const queryString = searchParams.toString()
  const response = await fetch(
    queryString
      ? `/api/chat_conversations?${queryString}`
      : '/api/chat_conversations',
  )

  return readJson<ChatConversationListResponse>(response)
}
