/**
 * conversation-cache.ts
 *
 * Client-side utilities for building conversation snapshots used to seed the
 * React Query cache before navigating to a new conversation route.
 *
 * For HTTP fetch functions, query keys, and cache mutations see:
 * → conversation-api.ts
 */

import { ROOT_PARENT_MESSAGE_UUID } from '../models/constants'
import type {
  ChatConversationDetail,
  ChatConversationSummary,
} from '../models/conversation'
import type { ChatState } from '../state/chat-state'

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

export function isConversationDetailEmpty(
  detail: Pick<ChatConversationDetail, 'current_leaf_message_uuid' | 'mapping'>,
) {
  const rootNode = detail.mapping[ROOT_PARENT_MESSAGE_UUID]

  return (
    detail.current_leaf_message_uuid == null &&
    (rootNode?.child_uuids.length ?? 0) === 0
  )
}
