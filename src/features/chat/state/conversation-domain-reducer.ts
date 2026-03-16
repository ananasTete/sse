import { produce } from "immer";
import type {
  ChatCitation,
  ChatMessage,
  ChatStopReason,
  ChatToolResultContent,
  ChatToolUseContent,
  NewChatMessage,
} from "../models/chat";
import type { ChatConversationDetail } from "../models/conversation";
import { ROOT_PARENT_MESSAGE_UUID } from "../models/constants";
import type { ConversationRuntimeState } from "./conversation-runtime";

export interface ConversationNode {
  child_uuids: string[];
  message: ChatMessage | null;
  parent_uuid: string | null;
  uuid: string;
}

export type ConversationMapping = Record<string, ConversationNode>;
export type ConversationDomainState = ChatConversationDetail;
export type ConversationRuntimeHelpers = Pick<
  ConversationRuntimeState,
  "active_child_uuid_by_parent_uuid" | "next_message_index"
>;

export type ConversationAction =
  | {
      message: NewChatMessage;
      type: "message-appended";
    }
  | {
      message: NewChatMessage;
      type: "message-snapshot-received";
      updatedAt: string;
    }
  | {
      index: number;
      messageUuid: string;
      type: "content-block-started";
      value: ChatMessage["content"][number];
    }
  | {
      index: number;
      messageUuid: string;
      text: string;
      type: "text-block-delta-received";
      updatedAt: string;
    }
  | {
      citation: ChatCitation;
      index: number;
      messageUuid: string;
      type: "text-block-citation-added";
      updatedAt: string;
    }
  | {
      index: number;
      input: Record<string, unknown> | null;
      messageUuid: string;
      type: "tool-use-input-updated";
      updatedAt: string;
    }
  | {
      displayContent: unknown | null;
      index: number;
      message: string | null;
      messageUuid: string;
      type: "tool-use-updated";
      updatedAt: string;
    }
  | {
      messageUuid: string;
      type: "tool-result-started";
      value: ChatToolResultContent;
    }
  | {
      displayContent?: unknown | null;
      isError?: boolean;
      message?: string | null;
      messageUuid: string;
      toolUseId: string;
      type: "tool-result-updated";
      updatedAt: string;
    }
  | {
      index: number;
      messageUuid: string;
      stopTimestamp: string;
      type: "content-block-stopped";
    }
  | {
      messageUuid: string;
      stopTimestamp: string;
      toolUseId: string;
      type: "tool-result-stopped";
    }
  | {
      messageUuid: string;
      metadata: Partial<ChatMessage["metadata"]>;
      type: "message-metadata-updated";
      updatedAt: string;
    }
  | {
      messageUuid: string;
      stopReason: ChatStopReason;
      type: "message-stop-reason-updated";
      updatedAt: string;
    }
  | {
      messageUuid: string;
      stoppedAt: string;
      type: "message-stream-stopped";
    }
  | {
      messageUuid: string;
      type: "branch-selected";
    }
  | {
      title: string;
      type: "title-updated";
      updatedAt: string;
    };

export function createEmptyConversationDomain(
  conversationId: string,
  timestamp: string,
): ConversationDomainState {
  return {
    created_at: timestamp,
    current_leaf_message_uuid: null,
    mapping: {
      [ROOT_PARENT_MESSAGE_UUID]: {
        child_uuids: [],
        message: null,
        parent_uuid: null,
        uuid: ROOT_PARENT_MESSAGE_UUID,
      },
    },
    title: "",
    updated_at: timestamp,
    uuid: conversationId,
  };
}

function findNodeByUuid(mapping: ConversationMapping, messageUuid: string) {
  return mapping[messageUuid];
}

function setConversationUpdatedAt(
  domain: ConversationDomainState,
  updatedAt: string,
) {
  domain.updated_at = updatedAt;
}

function getPreferredChildUuid(
  state: {
    domain: ConversationDomainState;
    runtime: ConversationRuntimeHelpers;
  },
  parentUuid: string,
) {
  const parentNode = state.domain.mapping[parentUuid];

  if (!parentNode || parentNode.child_uuids.length === 0) {
    return null;
  }

  const activeChildUuid =
    state.runtime.active_child_uuid_by_parent_uuid[parentUuid];

  if (activeChildUuid && parentNode.child_uuids.includes(activeChildUuid)) {
    return activeChildUuid;
  }

  return parentNode.child_uuids[0] ?? null;
}

function resolveLeafMessageUuid(
  state: {
    domain: ConversationDomainState;
    runtime: ConversationRuntimeHelpers;
  },
  startMessageUuid: string,
) {
  let currentMessageUuid = startMessageUuid;

  while (true) {
    const nextChildUuid = getPreferredChildUuid(state, currentMessageUuid);

    if (!nextChildUuid) {
      return currentMessageUuid;
    }

    currentMessageUuid = nextChildUuid;
  }
}

function appendMessageNode(
  draft: {
    domain: ConversationDomainState;
    runtime: ConversationRuntimeHelpers;
  },
  message: NewChatMessage,
) {
  const indexedMessage = {
    ...message,
    index: draft.runtime.next_message_index,
  } satisfies ChatMessage;

  // 更新 Leaf
  draft.domain.mapping[indexedMessage.uuid] = {
    child_uuids: [],
    message: indexedMessage,
    parent_uuid: indexedMessage.parent_message_uuid,
    uuid: indexedMessage.uuid,
  };

  const parentNode = draft.domain.mapping[indexedMessage.parent_message_uuid];

  // 更新 parent 的 child_uuids
  if (parentNode && !parentNode.child_uuids.includes(indexedMessage.uuid)) {
    parentNode.child_uuids.push(indexedMessage.uuid);
  }

  // 更新 active child 映射
  draft.runtime.active_child_uuid_by_parent_uuid[
    indexedMessage.parent_message_uuid
  ] = indexedMessage.uuid;

  // 更新 current leaf message uuid
  draft.domain.current_leaf_message_uuid = indexedMessage.uuid;

  // 更新 next message index
  draft.runtime.next_message_index += 1;

  // 更新 conversation updatedAt
  setConversationUpdatedAt(draft.domain, indexedMessage.updated_at);
}

function findToolUseBlock(
  message: ChatMessage | null | undefined,
  toolUseId: string,
) {
  return message?.content.find(
    (block): block is ChatToolUseContent =>
      block.type === "tool_use" && block.id === toolUseId,
  );
}

export function reduceConversationDomain(
  domain: ConversationDomainState,
  runtime: ConversationRuntimeHelpers,
  action: ConversationAction,
) {
  return produce({ domain, runtime }, (draft) => {
    switch (action.type) {
      case "message-appended":
        appendMessageNode(draft, action.message);
        return;

      case "message-snapshot-received": {
        const existingNode = findNodeByUuid(
          draft.domain.mapping,
          action.message.uuid,
        );

        if (existingNode) {
          const currentMessage = existingNode.message;

          if (currentMessage) {
            currentMessage.content = action.message.content;
            currentMessage.metadata = action.message.metadata;
            currentMessage.model = action.message.model;
            currentMessage.stop_reason = action.message.stop_reason;
            currentMessage.updated_at = action.updatedAt;
          }
        } else {
          appendMessageNode(draft, action.message);
        }

        setConversationUpdatedAt(draft.domain, action.updatedAt);
        return;
      }

      case "content-block-started": {
        const message = findNodeByUuid(
          draft.domain.mapping,
          action.messageUuid,
        )?.message;

        if (!message) {
          return;
        }

        message.content[action.index] = action.value;
        message.updated_at = action.value.start_timestamp;
        setConversationUpdatedAt(draft.domain, action.value.start_timestamp);
        return;
      }

      case "text-block-delta-received": {
        const message = findNodeByUuid(
          draft.domain.mapping,
          action.messageUuid,
        )?.message;
        const currentBlock = message?.content[action.index];

        if (!message || !currentBlock || currentBlock.type !== "text") {
          return;
        }

        currentBlock.text += action.text;
        message.updated_at = action.updatedAt;
        setConversationUpdatedAt(draft.domain, action.updatedAt);
        return;
      }

      case "text-block-citation-added": {
        const message = findNodeByUuid(
          draft.domain.mapping,
          action.messageUuid,
        )?.message;
        const currentBlock = message?.content[action.index];

        if (!message || !currentBlock || currentBlock.type !== "text") {
          return;
        }

        currentBlock.citations.push(action.citation);
        message.updated_at = action.updatedAt;
        setConversationUpdatedAt(draft.domain, action.updatedAt);
        return;
      }

      case "tool-use-input-updated": {
        const message = findNodeByUuid(
          draft.domain.mapping,
          action.messageUuid,
        )?.message;
        const currentBlock = message?.content[action.index];

        if (!message || !currentBlock || currentBlock.type !== "tool_use") {
          return;
        }

        currentBlock.input = action.input;
        message.updated_at = action.updatedAt;
        setConversationUpdatedAt(draft.domain, action.updatedAt);
        return;
      }

      case "tool-use-updated": {
        const message = findNodeByUuid(
          draft.domain.mapping,
          action.messageUuid,
        )?.message;
        const currentBlock = message?.content[action.index];

        if (!message || !currentBlock || currentBlock.type !== "tool_use") {
          return;
        }

        currentBlock.message = action.message;
        currentBlock.display_content = action.displayContent;
        message.updated_at = action.updatedAt;
        setConversationUpdatedAt(draft.domain, action.updatedAt);
        return;
      }

      case "tool-result-started": {
        const message = findNodeByUuid(
          draft.domain.mapping,
          action.messageUuid,
        )?.message;
        const toolUseBlock = findToolUseBlock(
          message,
          action.value.tool_use_id,
        );

        if (!message || !toolUseBlock) {
          return;
        }

        toolUseBlock.tool_result = action.value;
        toolUseBlock.stop_timestamp = null;
        message.updated_at = action.value.start_timestamp;
        setConversationUpdatedAt(draft.domain, action.value.start_timestamp);
        return;
      }

      case "tool-result-updated": {
        const message = findNodeByUuid(
          draft.domain.mapping,
          action.messageUuid,
        )?.message;
        const toolUseBlock = findToolUseBlock(message, action.toolUseId);
        const toolResult = toolUseBlock?.tool_result;

        if (!message || !toolUseBlock || !toolResult) {
          return;
        }

        if (Object.hasOwn(action, "message")) {
          toolResult.message = action.message ?? null;
        }

        if (Object.hasOwn(action, "displayContent")) {
          toolResult.display_content = action.displayContent ?? null;
        }

        if (typeof action.isError === "boolean") {
          toolResult.is_error = action.isError;
        }

        toolUseBlock.stop_timestamp = null;
        message.updated_at = action.updatedAt;
        setConversationUpdatedAt(draft.domain, action.updatedAt);
        return;
      }

      case "content-block-stopped": {
        const message = findNodeByUuid(
          draft.domain.mapping,
          action.messageUuid,
        )?.message;
        const currentBlock = message?.content[action.index];

        if (!message || !currentBlock) {
          return;
        }

        currentBlock.stop_timestamp = action.stopTimestamp;
        message.updated_at = action.stopTimestamp;
        setConversationUpdatedAt(draft.domain, action.stopTimestamp);
        return;
      }

      case "tool-result-stopped": {
        const message = findNodeByUuid(
          draft.domain.mapping,
          action.messageUuid,
        )?.message;
        const toolUseBlock = findToolUseBlock(message, action.toolUseId);
        const toolResult = toolUseBlock?.tool_result;

        if (!message || !toolUseBlock || !toolResult) {
          return;
        }

        toolResult.stop_timestamp = action.stopTimestamp;
        toolUseBlock.stop_timestamp = action.stopTimestamp;
        message.updated_at = action.stopTimestamp;
        setConversationUpdatedAt(draft.domain, action.stopTimestamp);
        return;
      }

      case "message-stop-reason-updated": {
        const message = findNodeByUuid(
          draft.domain.mapping,
          action.messageUuid,
        )?.message;

        if (!message) {
          return;
        }

        message.stop_reason = action.stopReason;
        message.updated_at = action.updatedAt;
        setConversationUpdatedAt(draft.domain, action.updatedAt);
        return;
      }

      case "message-metadata-updated": {
        const message = findNodeByUuid(
          draft.domain.mapping,
          action.messageUuid,
        )?.message;

        if (!message) {
          return;
        }

        message.metadata = {
          ...message.metadata,
          ...action.metadata,
        };
        message.updated_at = action.updatedAt;
        setConversationUpdatedAt(draft.domain, action.updatedAt);
        return;
      }

      case "message-stream-stopped": {
        const message = findNodeByUuid(
          draft.domain.mapping,
          action.messageUuid,
        )?.message;

        if (!message) {
          setConversationUpdatedAt(draft.domain, action.stoppedAt);
          return;
        }

        for (const block of message.content) {
          block.stop_timestamp ??= action.stoppedAt;

          if (block.type === "tool_use" && block.tool_result) {
            block.tool_result.stop_timestamp ??= action.stoppedAt;
          }
        }

        message.stop_reason = "user_canceled";
        message.updated_at = action.stoppedAt;
        setConversationUpdatedAt(draft.domain, action.stoppedAt);
        return;
      }

      case "branch-selected": {
        const selectedNode = findNodeByUuid(
          draft.domain.mapping,
          action.messageUuid,
        );
        const parentUuid = selectedNode?.parent_uuid;

        if (!selectedNode || !parentUuid) {
          return;
        }

        draft.runtime.active_child_uuid_by_parent_uuid[parentUuid] =
          action.messageUuid;
        draft.domain.current_leaf_message_uuid = resolveLeafMessageUuid(
          draft,
          action.messageUuid,
        );
        return;
      }

      case "title-updated":
        draft.domain.title = action.title;
        setConversationUpdatedAt(draft.domain, action.updatedAt);
        return;

      default:
        return;
    }
  });
}
