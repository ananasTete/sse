/**
 * chat-selectors.ts
 *
 * Pure read functions that derive data from ChatState.
 * All selectors are side-effect free and depend only on their arguments.
 */

import type { ChatMessage } from '../models/chat'
import type { ChatState } from './chat-state'

/**
 * Walks the message tree from the current leaf node upward through parent
 * pointers and returns the full active branch in chronological order.
 */
export function selectCurrentBranchMessages(state: ChatState) {
  const messages: ChatMessage[] = []
  let currentMessageUuid = state.current_leaf_message_uuid

  while (currentMessageUuid) {
    const currentNode = state.mapping[currentMessageUuid]

    if (!currentNode) {
      break
    }

    if (currentNode.message) {
      messages.push(currentNode.message)
    }

    currentMessageUuid = currentNode.parent_uuid
  }

  return messages.reverse()
}

/**
 * Returns the list of sibling branch UUIDs for a given parent message node.
 * Useful for rendering branch navigation controls (prev/next sibling).
 */
export function selectBranchChildUuids(
  state: ChatState,
  parentMessageUuid: string,
) {
  return [...(state.mapping[parentMessageUuid]?.child_uuids ?? [])]
}

/**
 * Looks up a message by its UUID within the flat mapping tree.
 * Returns null if the node does not exist or has no attached message.
 */
export function getMessageByUuid(state: ChatState, messageUuid: string) {
  return state.mapping[messageUuid]?.message ?? null
}
