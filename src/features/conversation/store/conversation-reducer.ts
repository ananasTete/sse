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
 * 在 ChatConversationDetail（后端 DTO）的基础上，额外携带前端领域层维护的字段。
 *
 * 分支选择策略：默认显示每个父节点的最后一个子节点（child_uuids 的末尾）。
 */
export interface ConversationDomainState extends ChatConversationDetail {
  current_branch_message_uuids: string[];
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

// 创建空 domain 数据
export function createEmptyConversationDomain(
  conversationId: string,
  timestamp: string,
): ConversationDomainState {
  const domain: ConversationDomainState = {
    uuid: conversationId,
    title: "",
    created_at: timestamp,
    updated_at: timestamp,
    current_leaf_message_uuid: null,
    current_branch_message_uuids: [],
    mapping: {
      [ROOT_PARENT_MESSAGE_UUID]: {
        child_uuids: [],
        message: null,
        parent_uuid: null,
        uuid: ROOT_PARENT_MESSAGE_UUID,
      },
    },
  };

  domain.current_branch_message_uuids = deriveCurrentBranchMessageUuids(domain);
  return domain;
}

function findNodeByUuid(mapping: ConversationMapping, messageUuid: string) {
  return mapping[messageUuid];
}

// 从某个消息节点找到最新的 leaf 节点
function resolveLeafMessageUuid(
  domain: ConversationDomainState,
  startMessageUuid: string,
) {
  let currentMessageUuid = startMessageUuid;

  while (true) {
    const node = domain.mapping[currentMessageUuid];

    if (!node || node.child_uuids.length === 0) {
      return currentMessageUuid;
    }

    currentMessageUuid = node.child_uuids.at(-1)!;
  }
}

export function deriveCurrentBranchMessageUuids(
  domain: Pick<
    ConversationDomainState,
    "current_leaf_message_uuid" | "mapping"
  >,
): string[] {
  const uuids: string[] = [];
  let cursor = domain.current_leaf_message_uuid;

  while (cursor) {
    const node = domain.mapping[cursor];

    if (!node) {
      break;
    }

    if (node.message) {
      uuids.push(cursor);
    }

    cursor = node.parent_uuid;
  }

  uuids.reverse();
  return uuids;
}

// 插入新消息
function appendMessageNode(
  domain: ConversationDomainState,
  message: NewChatMessage,
) {
  domain.mapping[message.uuid] = {
    child_uuids: [],
    message,
    parent_uuid: message.parent_uuid,
    uuid: message.uuid,
  };

  const parentNode = domain.mapping[message.parent_uuid];

  if (parentNode && !parentNode.child_uuids.includes(message.uuid)) {
    parentNode.child_uuids.push(message.uuid);
  }

  domain.current_leaf_message_uuid = message.uuid;
  domain.current_branch_message_uuids = deriveCurrentBranchMessageUuids(domain);
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
 * Domain 状态机的 mutable 入口。
 *
 * 签名：(draft, action) => void
 *
 * - 直接修改传入的 draft，不创建额外的 Immer Proxy
 * - 调用方需要保证 draft 处在可变的上下文中（如 zustand immer 的 set() 回调）
 * - 不感知 runtime（status / activeRequest / errorMessage）
 * - 所有 domain 内字段均在此函数内一致性更新
 */
export function applyConversationAction(
  draft: ConversationDomainState,
  action: ConversationAction,
): void {
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

        draft.current_leaf_message_uuid = resolveLeafMessageUuid(
          draft,
          action.messageUuid,
        );
        draft.current_branch_message_uuids =
          deriveCurrentBranchMessageUuids(draft);
        return;
      }

      case "title-updated":
        draft.title = action.title;
        return;

      default:
        return;
    }
}
