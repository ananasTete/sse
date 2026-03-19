import { produce } from "immer";
import type {
  ChatCitation,
  ChatMessage,
  ChatToolResultContent,
  ChatToolUseContent,
  NewChatMessage,
} from "../models/message";
import type { ChatConversationDetail } from "../models/conversation";
import type { ConversationMapping } from "../models/conversation-node";
import { ROOT_PARENT_MESSAGE_UUID } from "../models/constants";

/**
 * 领域状态：描述"会话业务实体是什么样的"。
 *
 * 在 ChatConversationDetail（后端 DTO）的基础上，额外携带两个前端领域层维护的字段：
 *
 * - active_child_uuid_by_parent_uuid：消息树的"活跃路径索引"。
 *   记录每个父节点当前选中的子分支，是 mapping + current_leaf_message_uuid 的派生结构。
 *   虽然后端不持久化它，但它描述的是"对话树现在是什么样的"，属于领域概念。
 *
 * - next_message_index：下一条本地追加消息的顺序号，等价于 MAX(message.index) + 1。
 *   同样可以从 mapping 派生，是消息实体的计数器，属于领域数据。
 *
 * 这两个字段曾被误放入 Runtime。Runtime 只应描述程序行为（正在请求、出错了），
 * 不应描述业务实体状态。
 */
export interface ConversationDomainState extends ChatConversationDetail {
  active_child_uuid_by_parent_uuid: Record<string, string>;
  next_message_index: number;
}

export type ConversationAction =
  | {
      message: NewChatMessage;
      type: "message-appended";
    }
  | {
      message: NewChatMessage;
      type: "message-snapshot-received";
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
    }
  | {
      citation: ChatCitation;
      index: number;
      messageUuid: string;
      type: "text-block-citation-added";
    }
  | {
      index: number;
      messageUuid: string;
      type: "tool-use-updated";
      update: Partial<
        Pick<ChatToolUseContent, "display_content" | "input" | "message">
      >;
    }
  | {
      messageUuid: string;
      type: "tool-result-started";
      value: ChatToolResultContent;
    }
  | {
      messageUuid: string;
      toolUseId: string;
      type: "tool-result-updated";
      update: Partial<
        Pick<ChatToolResultContent, "display_content" | "is_error" | "message">
      >;
    }
  | {
      index: number;
      messageUuid: string;
      stop_timestamp: string;
      type: "content-block-stopped";
    }
  | {
      messageUuid: string;
      stop_timestamp: string;
      toolUseId: string;
      type: "tool-result-stopped";
    }
  | {
      messageUuid: string;
      metadata: Partial<ChatMessage["metadata"]>;
      type: "message-metadata-updated";
    }
  | {
      delta: Partial<Pick<ChatMessage, "stop_reason">> & {
        stop_sequence?: string | null;
      };
      messageUuid: string;
      type: "message-updated";
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
    };

export function createEmptyConversationDomain(
  conversationId: string,
  timestamp: string,
): ConversationDomainState {
  return {
    active_child_uuid_by_parent_uuid: {},
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
    next_message_index: 0,
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
  domain: ConversationDomainState,
  parentUuid: string,
) {
  const parentNode = domain.mapping[parentUuid];

  if (!parentNode || parentNode.child_uuids.length === 0) {
    return null;
  }

  const activeChildUuid = domain.active_child_uuid_by_parent_uuid[parentUuid];

  if (activeChildUuid && parentNode.child_uuids.includes(activeChildUuid)) {
    return activeChildUuid;
  }

  return parentNode.child_uuids[0] ?? null;
}

function resolveLeafMessageUuid(
  domain: ConversationDomainState,
  startMessageUuid: string,
) {
  let currentMessageUuid = startMessageUuid;

  while (true) {
    const nextChildUuid = getPreferredChildUuid(domain, currentMessageUuid);

    if (!nextChildUuid) {
      return currentMessageUuid;
    }

    currentMessageUuid = nextChildUuid;
  }
}

function appendMessageNode(
  domain: ConversationDomainState,
  message: NewChatMessage,
) {
  const indexedMessage = {
    ...message,
    index: domain.next_message_index,
  } satisfies ChatMessage;

  domain.mapping[indexedMessage.uuid] = {
    child_uuids: [],
    message: indexedMessage,
    parent_uuid: indexedMessage.parent_uuid,
    uuid: indexedMessage.uuid,
  };

  const parentNode = domain.mapping[indexedMessage.parent_uuid];

  if (parentNode && !parentNode.child_uuids.includes(indexedMessage.uuid)) {
    parentNode.child_uuids.push(indexedMessage.uuid);
  }

  domain.active_child_uuid_by_parent_uuid[indexedMessage.parent_uuid] =
    indexedMessage.uuid;

  domain.current_leaf_message_uuid = indexedMessage.uuid;
  domain.next_message_index += 1;
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

/**
 * Domain 状态机的纯函数入口。
 *
 * 签名：(domain, action) => domain
 *
 * - 只接收 domain，只返回 domain
 * - 不感知 runtime（status / activeRequest / errorMessage）
 * - 所有 domain 内字段（包括 active_child_uuid_by_parent_uuid、next_message_index）
 *   均在此函数内一致性更新
 */
export function reduceConversationDomain(
  domain: ConversationDomainState,
  action: ConversationAction,
): ConversationDomainState {
  return produce(domain, (draft) => {
    switch (action.type) {
      case "message-appended":
        appendMessageNode(draft, action.message);
        return;

      case "message-snapshot-received": {
        const existingNode = findNodeByUuid(draft.mapping, action.message.uuid);

        if (existingNode) {
          const currentMessage = existingNode.message;

          if (currentMessage) {
            currentMessage.content = action.message.content;
            currentMessage.created_at = action.message.created_at;
            currentMessage.metadata = action.message.metadata;
            currentMessage.model = action.message.model;
            currentMessage.stop_reason = action.message.stop_reason;
            currentMessage.updated_at = action.message.updated_at;
          }
        } else {
          appendMessageNode(draft, action.message);
        }

        setConversationUpdatedAt(draft, action.message.updated_at);
        return;
      }

      case "content-block-started": {
        const message = findNodeByUuid(
          draft.mapping,
          action.messageUuid,
        )?.message;

        if (!message) {
          return;
        }

        message.content[action.index] = action.value;
        return;
      }

      case "text-block-delta-received": {
        const message = findNodeByUuid(
          draft.mapping,
          action.messageUuid,
        )?.message;
        const currentBlock = message?.content[action.index];

        if (!message || !currentBlock || currentBlock.type !== "text") {
          return;
        }

        currentBlock.text += action.text;
        return;
      }

      case "text-block-citation-added": {
        const message = findNodeByUuid(
          draft.mapping,
          action.messageUuid,
        )?.message;
        const currentBlock = message?.content[action.index];

        if (!message || !currentBlock || currentBlock.type !== "text") {
          return;
        }

        currentBlock.citations.push(action.citation);
        return;
      }

      case "tool-use-updated": {
        const message = findNodeByUuid(
          draft.mapping,
          action.messageUuid,
        )?.message;
        const currentBlock = message?.content[action.index];

        if (!message || !currentBlock || currentBlock.type !== "tool_use") {
          return;
        }

        if (Object.hasOwn(action.update, "input")) {
          currentBlock.input = action.update.input ?? null;
        }

        if (Object.hasOwn(action.update, "message")) {
          currentBlock.message = action.update.message ?? null;
        }

        if (Object.hasOwn(action.update, "display_content")) {
          currentBlock.display_content = action.update.display_content ?? null;
        }
        return;
      }

      case "tool-result-started": {
        const message = findNodeByUuid(
          draft.mapping,
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
        return;
      }

      case "tool-result-updated": {
        const message = findNodeByUuid(
          draft.mapping,
          action.messageUuid,
        )?.message;
        const toolUseBlock = findToolUseBlock(message, action.toolUseId);
        const toolResult = toolUseBlock?.tool_result;

        if (!message || !toolUseBlock || !toolResult) {
          return;
        }

        if (Object.hasOwn(action.update, "message")) {
          toolResult.message = action.update.message ?? null;
        }

        if (Object.hasOwn(action.update, "display_content")) {
          toolResult.display_content = action.update.display_content ?? null;
        }

        if (typeof action.update.is_error === "boolean") {
          toolResult.is_error = action.update.is_error;
        }

        toolUseBlock.stop_timestamp = null;
        return;
      }

      case "content-block-stopped": {
        const message = findNodeByUuid(
          draft.mapping,
          action.messageUuid,
        )?.message;
        const currentBlock = message?.content[action.index];

        if (!message || !currentBlock) {
          return;
        }

        currentBlock.stop_timestamp = action.stop_timestamp;
        return;
      }

      case "message-updated": {
        const message = findNodeByUuid(
          draft.mapping,
          action.messageUuid,
        )?.message;

        if (!message) {
          return;
        }

        Object.assign(message, action.delta);
        return;
      }

      case "tool-result-stopped": {
        const message = findNodeByUuid(
          draft.mapping,
          action.messageUuid,
        )?.message;
        const toolUseBlock = findToolUseBlock(message, action.toolUseId);
        const toolResult = toolUseBlock?.tool_result;

        if (!message || !toolUseBlock || !toolResult) {
          return;
        }

        toolResult.stop_timestamp = action.stop_timestamp;
        toolUseBlock.stop_timestamp = action.stop_timestamp;
        return;
      }

      case "message-metadata-updated": {
        const message = findNodeByUuid(
          draft.mapping,
          action.messageUuid,
        )?.message;

        if (!message) {
          return;
        }

        message.metadata = {
          ...message.metadata,
          ...action.metadata,
        };
        return;
      }

      case "message-stream-stopped": {
        const message = findNodeByUuid(
          draft.mapping,
          action.messageUuid,
        )?.message;

        if (!message) {
          setConversationUpdatedAt(draft, action.stoppedAt);
          return;
        }

        for (const block of message.content) {
          block.stop_timestamp ??= action.stoppedAt;

          if (block.type === "tool_use" && block.tool_result) {
            block.tool_result.stop_timestamp ??= action.stoppedAt;
          }
        }

        message.stop_reason = "user_canceled";
        return;
      }

      case "branch-selected": {
        const selectedNode = findNodeByUuid(draft.mapping, action.messageUuid);
        const parentUuid = selectedNode?.parent_uuid;

        if (!selectedNode || !parentUuid) {
          return;
        }

        draft.active_child_uuid_by_parent_uuid[parentUuid] = action.messageUuid;
        draft.current_leaf_message_uuid = resolveLeafMessageUuid(
          draft,
          action.messageUuid,
        );
        return;
      }

      case "title-updated":
        draft.title = action.title;
        return;

      default:
        return;
    }
  });
}
