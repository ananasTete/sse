import type { ChatStatus } from "../models/message";
import type { ConversationMapping } from "../models/conversation-node";

export interface ActiveRequest {
  assistantMessageUuid: string;
  controller: AbortController;
}

/**
 * 运行时状态：仅描述"程序当前在做什么"，不描述业务实体。
 *
 * 特点：
 * - 不可序列化（AbortController）或刷新后无意义
 * - 不需要持久化到后端
 * - 随进程生命周期消亡
 */
export interface ConversationRuntimeState {
  activeRequest: ActiveRequest | null;
  errorMessage: string | null;
  status: ChatStatus;
}

export function createInitialConversationRuntimeState(): ConversationRuntimeState {
  return {
    activeRequest: null,
    errorMessage: null,
    status: "ready",
  };
}

/**
 * 从消息树和当前叶子节点构建"活跃子节点映射"。
 * 用于在 hydrate 时初始化 domain.active_child_uuid_by_parent_uuid。
 */
export function buildActiveChildMap(
  mapping: ConversationMapping,
  currentLeafMessageUuid: string | null,
) {
  const activeChildUuidByParentUuid: Record<string, string> = {};

  for (const node of Object.values(mapping)) {
    const firstChildUuid = node.child_uuids[0];

    if (firstChildUuid) {
      activeChildUuidByParentUuid[node.uuid] = firstChildUuid;
    }
  }

  let cursor = currentLeafMessageUuid;

  while (cursor) {
    const node = mapping[cursor];

    if (!node?.parent_uuid) {
      break;
    }

    activeChildUuidByParentUuid[node.parent_uuid] = node.uuid;
    cursor = node.parent_uuid;
  }

  return activeChildUuidByParentUuid;
}

/**
 * 从消息树中推算下一条消息应使用的顺序号（即最大 index + 1）。
 * 用于在 hydrate 时初始化 domain.next_message_index。
 */
export function getNextMessageIndex(mapping: ConversationMapping) {
  return (
    Object.values(mapping).reduce(
      (maxIndex, node) => Math.max(maxIndex, node.message?.index ?? -1),
      -1,
    ) + 1
  );
}
