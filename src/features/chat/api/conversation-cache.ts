/**
 * conversation-cache.ts
 *
 * Client-side utilities for building conversation snapshots used to seed the
 * React Query cache before navigating to a new conversation route.
 *
 * For HTTP fetch functions, query keys, and cache mutations see:
 * → conversation-api.ts
 */

import { ROOT_PARENT_MESSAGE_UUID } from '../../conversation/models/constants'
import type {
  ChatConversationDetail,
  PendingInitialConversationSubmission,
} from '../../conversation/models/conversation'

export function isConversationDetailEmpty(
  detail: Pick<ChatConversationDetail, 'current_leaf_message_uuid' | 'mapping'>,
) {
  const rootNode = detail.mapping[ROOT_PARENT_MESSAGE_UUID]

  return (
    detail.current_leaf_message_uuid == null &&
    (rootNode?.child_uuids.length ?? 0) === 0
  )
}

export function shouldUsePendingConversationSeed({
  detail,
  initialSubmission,
}: {
  detail?:
    | Pick<ChatConversationDetail, 'current_leaf_message_uuid' | 'mapping'>
    | null
  initialSubmission?: PendingInitialConversationSubmission | null
}) {
  return (
    initialSubmission != null &&
    detail != null &&
    isConversationDetailEmpty(detail)
  )
}
