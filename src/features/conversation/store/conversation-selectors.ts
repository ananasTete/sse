/**
 * Pure read functions that derive data from ConversationState.
 * All selectors are side-effect free and depend only on their arguments.
 */

import type { ChatConversationDetail } from "../models/conversation";

type ConversationReadState = {
  domain: Pick<
    ChatConversationDetail & {
      active_child_uuid_by_parent_uuid: Record<string, string>;
    },
    "current_leaf_message_uuid" | "mapping" | "active_child_uuid_by_parent_uuid"
  >;
  runtime: {
    activeRequest: { assistantMessageUuid: string } | null;
  };
};

// 根据 current_leaf_message_uuid 计算当前分支的消息 UUID 列表（只关心树结构，不取内容）
export function selectCurrentBranchMessageUuids(
  conversation: Pick<ConversationReadState, "domain">,
): string[] {
  const uuids: string[] = [];
  let cursor = conversation.domain.current_leaf_message_uuid;

  while (cursor) {
    const node = conversation.domain.mapping[cursor];

    if (!node) {
      break;
    }

    if (node.message) {
      uuids.push(cursor);
    }

    cursor = node.parent_uuid;
  }

  return uuids.reverse();
}

// 获取某条消息的兄弟节点列表（父节点的 child_uuids）
// 直接返回 Immer store 中的引用，利用结构共享保证引用稳定性
export function selectSiblingUuids(
  conversation: Pick<ConversationReadState, "domain">,
  messageUuid: string,
): string[] | null {
  const node = conversation.domain.mapping[messageUuid];

  if (!node?.parent_uuid) {
    return null;
  }

  const parentNode = conversation.domain.mapping[node.parent_uuid];

  if (!parentNode || parentNode.child_uuids.length <= 1) {
    return null;
  }

  return parentNode.child_uuids;
}

// 获取某条消息
export function getMessageByUuid(
  conversation: ConversationReadState,
  messageUuid: string,
) {
  return conversation.domain.mapping[messageUuid]?.message ?? null;
}

export function findIncompleteStreamMessageUuid(
  detail: Pick<ChatConversationDetail, "mapping">,
): string | null {
  const lastMessage = Object.values(detail.mapping)
    .map((node) => node.message)
    .filter((msg): msg is NonNullable<typeof msg> => msg !== null)
    .sort((left, right) => right.index - left.index)
    .find((msg) => msg.role === "assistant" && msg.stop_reason === null);

  return lastMessage?.uuid ?? null;
}
