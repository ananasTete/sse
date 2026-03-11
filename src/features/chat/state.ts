import { produce } from 'immer'

import { ROOT_PARENT_MESSAGE_UUID } from './constants'
import type {
  ChatCitation,
  ChatMessage,
  ChatStatus,
  ChatToolResultContent,
  ChatToolUseContent,
  NewChatMessage,
} from './types'

export interface ConversationNode {
  child_uuids: string[]
  message: ChatMessage | null
  parent_uuid: string | null
  uuid: string
}

export interface ChatState {
  active_child_uuid_by_parent_uuid: Record<string, string>
  current_leaf_message_uuid: string | null
  input: string
  mapping: Record<string, ConversationNode>
  next_message_index: number
  status: ChatStatus
}

export type ChatAction =
  | {
      input: string
      type: 'input-changed'
    }
  | {
      message: NewChatMessage
      type: 'request-message-added'
    }
  | {
      type: 'request-submitted'
    }
  | {
      index: number
      messageUuid: string
      type: 'content-block-started'
      value: ChatMessage['content'][number]
    }
  | {
      index: number
      messageUuid: string
      text: string
      type: 'text-block-delta-received'
      updatedAt: string
    }
  | {
      citation: ChatCitation
      index: number
      messageUuid: string
      type: 'text-block-citation-added'
      updatedAt: string
    }
  | {
      index: number
      input: Record<string, unknown> | null
      messageUuid: string
      type: 'tool-use-input-updated'
      updatedAt: string
    }
  | {
      displayContent: unknown | null
      index: number
      message: string | null
      messageUuid: string
      type: 'tool-use-updated'
      updatedAt: string
    }
  | {
      messageUuid: string
      type: 'tool-result-started'
      value: ChatToolResultContent
    }
  | {
      displayContent?: unknown | null
      isError?: boolean
      message?: string | null
      messageUuid: string
      toolUseId: string
      type: 'tool-result-updated'
      updatedAt: string
    }
  | {
      index: number
      messageUuid: string
      stopTimestamp: string
      type: 'content-block-stopped'
    }
  | {
      messageUuid: string
      stopTimestamp: string
      toolUseId: string
      type: 'tool-result-stopped'
    }
  | {
      messageUuid: string
      metadata: Partial<ChatMessage['metadata']>
      type: 'message-metadata-updated'
      updatedAt: string
    }
  | {
      messageUuid: string
      stopReason: ChatMessage['stop_reason']
      type: 'message-stop-reason-updated'
      updatedAt: string
    }
  | {
      type: 'message-stream-finished'
    }
  | {
      messageUuid: string
      stoppedAt: string
      type: 'message-stream-stopped'
    }
  | {
      type: 'message-stream-failed'
    }
  | {
      messageUuid: string
      type: 'branch-selected'
    }

export const initialChatState: ChatState = {
  active_child_uuid_by_parent_uuid: {}, // 有子分支的父节点和 active 子节点的 map，用来在切换会之前的分之后保持其后续分支选择
  current_leaf_message_uuid: null, // 当前分支下最后一个节点的 id，可以根据这个节点的 parent_id 继续向上找到整条分支节点数组
  input: '',
  mapping: { // 因为需要支持分支，内部维护一个扁平树结构。不需要分支，直接维护一个 message 数组即可
    [ROOT_PARENT_MESSAGE_UUID]: {
      child_uuids: [],
      message: null,
      parent_uuid: null,
      uuid: ROOT_PARENT_MESSAGE_UUID,
    },
  },
  next_message_index: 0,
  status: 'ready',
}

function findNodeByUuid(
  mapping: ChatState['mapping'],
  messageUuid: string,
) {
  return mapping[messageUuid]
}

function getPreferredChildUuid(
  state: Pick<
    ChatState,
    'active_child_uuid_by_parent_uuid' | 'mapping'
  >,
  parentUuid: string,
) {
  const parentNode = state.mapping[parentUuid]

  if (!parentNode || parentNode.child_uuids.length === 0) {
    return null
  }

  const activeChildUuid =
    state.active_child_uuid_by_parent_uuid[parentUuid]

  if (activeChildUuid && parentNode.child_uuids.includes(activeChildUuid)) {
    return activeChildUuid
  }

  return parentNode.child_uuids[0] ?? null
}

function resolveLeafMessageUuid(
  state: Pick<
    ChatState,
    'active_child_uuid_by_parent_uuid' | 'mapping'
  >,
  startMessageUuid: string,
) {
  let currentMessageUuid = startMessageUuid

  while (true) {
    const nextChildUuid = getPreferredChildUuid(state, currentMessageUuid)

    if (!nextChildUuid) {
      return currentMessageUuid
    }

    currentMessageUuid = nextChildUuid
  }
}

function appendMessageNode(
  draft: ChatState,
  message: NewChatMessage,
) {
  const indexedMessage = {
    ...message,
    index: draft.next_message_index,
  } satisfies ChatMessage

  draft.mapping[indexedMessage.uuid] = {
    child_uuids: [],
    message: indexedMessage,
    parent_uuid: indexedMessage.parent_message_uuid,
    uuid: indexedMessage.uuid,
  }

  const parentNode = draft.mapping[indexedMessage.parent_message_uuid]

  if (parentNode && !parentNode.child_uuids.includes(indexedMessage.uuid)) {
    parentNode.child_uuids.push(indexedMessage.uuid)
  }

  draft.active_child_uuid_by_parent_uuid[indexedMessage.parent_message_uuid] =
    indexedMessage.uuid
  draft.current_leaf_message_uuid = indexedMessage.uuid
  draft.next_message_index += 1
}

function findToolUseBlock(
  message: ChatMessage | null | undefined,
  toolUseId: string,
) {
  return message?.content.find(
    (block): block is ChatToolUseContent =>
      block.type === 'tool_use' && block.id === toolUseId,
  )
}

// 根据 current_leaf_message_uuid 节点的 parent_id 一路向上遍历父节点，再反转得到完整分支
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

export function getBranchState(state: ChatState, parentMessageUuid: string) {
  return [...(state.mapping[parentMessageUuid]?.child_uuids ?? [])]
}

export function getMessageByUuid(state: ChatState, messageUuid: string) {
  return state.mapping[messageUuid]?.message ?? null
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  return produce(state, (draft) => {
    switch (action.type) {
      case 'input-changed':
        draft.input = action.input
        return

      case 'request-submitted':
        draft.status = 'submitted'
        return

      case 'request-message-added':
        if (action.message.role === 'user') {
          draft.input = ''
          draft.status = 'submitted'
        } else if (action.message.role === 'assistant') {
          draft.status = 'streaming'
        }

        appendMessageNode(draft, action.message)
        return

      case 'content-block-started': {
        const message = findNodeByUuid(draft.mapping, action.messageUuid)?.message

        if (!message) {
          return
        }

        message.content[action.index] = action.value
        message.updated_at = action.value.start_timestamp
        return
      }

      case 'text-block-delta-received': {
        const message = findNodeByUuid(draft.mapping, action.messageUuid)?.message
        const currentBlock = message?.content[action.index]

        if (!message || !currentBlock || currentBlock.type !== 'text') {
          return
        }

        currentBlock.text += action.text
        message.updated_at = action.updatedAt
        return
      }

      case 'text-block-citation-added': {
        const message = findNodeByUuid(draft.mapping, action.messageUuid)?.message
        const currentBlock = message?.content[action.index]

        if (!message || !currentBlock || currentBlock.type !== 'text') {
          return
        }

        currentBlock.citations.push(action.citation)
        message.updated_at = action.updatedAt
        return
      }

      case 'tool-use-input-updated': {
        const message = findNodeByUuid(draft.mapping, action.messageUuid)?.message
        const currentBlock = message?.content[action.index]

        if (!message || !currentBlock || currentBlock.type !== 'tool_use') {
          return
        }

        currentBlock.input = action.input
        message.updated_at = action.updatedAt
        return
      }

      case 'tool-use-updated': {
        const message = findNodeByUuid(draft.mapping, action.messageUuid)?.message
        const currentBlock = message?.content[action.index]

        if (!message || !currentBlock || currentBlock.type !== 'tool_use') {
          return
        }

        currentBlock.message = action.message
        currentBlock.display_content = action.displayContent
        message.updated_at = action.updatedAt
        return
      }

      case 'tool-result-started': {
        const message = findNodeByUuid(draft.mapping, action.messageUuid)?.message
        const toolUseBlock = findToolUseBlock(
          message,
          action.value.tool_use_id,
        )

        if (!message || !toolUseBlock) {
          return
        }

        toolUseBlock.tool_result = action.value
        toolUseBlock.stop_timestamp = null
        message.updated_at = action.value.start_timestamp
        return
      }

      case 'tool-result-updated': {
        const message = findNodeByUuid(draft.mapping, action.messageUuid)?.message
        const toolUseBlock = findToolUseBlock(message, action.toolUseId)
        const toolResult = toolUseBlock?.tool_result

        if (!message || !toolUseBlock || !toolResult) {
          return
        }

        if (Object.hasOwn(action, 'message')) {
          toolResult.message = action.message ?? null
        }

        if (Object.hasOwn(action, 'displayContent')) {
          toolResult.display_content = action.displayContent ?? null
        }

        if (typeof action.isError === 'boolean') {
          toolResult.is_error = action.isError
        }

        toolUseBlock.stop_timestamp = null
        message.updated_at = action.updatedAt
        return
      }

      case 'content-block-stopped': {
        const message = findNodeByUuid(draft.mapping, action.messageUuid)?.message
        const currentBlock = message?.content[action.index]

        if (!message || !currentBlock) {
          return
        }

        currentBlock.stop_timestamp = action.stopTimestamp
        message.updated_at = action.stopTimestamp
        return
      }

      case 'tool-result-stopped': {
        const message = findNodeByUuid(draft.mapping, action.messageUuid)?.message
        const toolUseBlock = findToolUseBlock(message, action.toolUseId)
        const toolResult = toolUseBlock?.tool_result

        if (!message || !toolUseBlock || !toolResult) {
          return
        }

        toolResult.stop_timestamp = action.stopTimestamp
        toolUseBlock.stop_timestamp = action.stopTimestamp
        message.updated_at = action.stopTimestamp
        return
      }

      case 'message-stop-reason-updated': {
        const message = findNodeByUuid(draft.mapping, action.messageUuid)?.message

        if (!message) {
          return
        }

        message.stop_reason = action.stopReason
        message.updated_at = action.updatedAt
        return
      }

      case 'message-metadata-updated': {
        const message = findNodeByUuid(draft.mapping, action.messageUuid)?.message

        if (!message) {
          return
        }

        message.metadata = {
          ...message.metadata,
          ...action.metadata,
        }
        message.updated_at = action.updatedAt
        return
      }

      case 'message-stream-finished':
        draft.status = 'ready'
        return

      case 'message-stream-stopped': {
        const message = findNodeByUuid(draft.mapping, action.messageUuid)?.message

        if (!message) {
          draft.status = 'ready'
          return
        }

        for (const block of message.content) {
          block.stop_timestamp ??= action.stoppedAt

          if (block.type === 'tool_use' && block.tool_result) {
            block.tool_result.stop_timestamp ??= action.stoppedAt
          }
        }

        message.stop_reason = 'user_canceled'
        message.updated_at = action.stoppedAt
        draft.status = 'ready'
        return
      }

      case 'message-stream-failed':
        draft.status = 'error'
        return

      case 'branch-selected': {
        const selectedNode = findNodeByUuid(draft.mapping, action.messageUuid)
        const parentUuid = selectedNode?.parent_uuid

        if (!selectedNode || !parentUuid) {
          return
        }

        draft.active_child_uuid_by_parent_uuid[parentUuid] = action.messageUuid
        draft.current_leaf_message_uuid = resolveLeafMessageUuid(
          draft,
          action.messageUuid,
        )
        return
      }

      default:
        return
    }
  })
}
