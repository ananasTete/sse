/**
 * Pure read functions that derive data from ConversationState.
 * All selectors are side-effect free and depend only on their arguments.
 */

import { deriveCurrentBranchMessageUuids } from "./conversation-reducer";
import type { ChatConversationDetail } from "../models/conversation";

type ConversationReadState = {
  domain: Pick<
    ChatConversationDetail,
    "current_leaf_message_uuid" | "mapping"
  > & {
    current_branch_message_uuids?: string[];
  };
  runtime: {
    activeRequest: { assistantMessageUuid: string } | null;
  };
};

// 优先返回 domain 内缓存的当前分支 UUID 列表；缺失时回退到现算。
export function selectCurrentBranchMessageUuids(
  conversation: Pick<ConversationReadState, "domain">,
): string[] {
  return (
    conversation.domain.current_branch_message_uuids ??
    deriveCurrentBranchMessageUuids(conversation.domain)
  );
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
  detail: Pick<ChatConversationDetail, "current_leaf_message_uuid" | "mapping">,
): string | null {
  const leafUuid = detail.current_leaf_message_uuid;

  if (!leafUuid) {
    return null;
  }

  const leafMessage = detail.mapping[leafUuid]?.message;

  if (
    leafMessage &&
    leafMessage.role === "assistant" &&
    leafMessage.stop_reason === null
  ) {
    return leafMessage.uuid;
  }

  return null;
}
