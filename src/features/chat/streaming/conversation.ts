import { ROOT_PARENT_MESSAGE_UUID } from "../models/constants";
import type {
  ChatConversationDetail,
  ChatConversationSummary,
} from "../models/conversation";
import type { ConversationMapping } from "../state/conversation-domain-reducer";

export const FALLBACK_CONVERSATION_TITLE = "New conversation";

/**
 * 创建空的对话映射结构
 */
function createEmptyMapping(): ConversationMapping {
  return {
    [ROOT_PARENT_MESSAGE_UUID]: {
      child_uuids: [],
      message: null,
      parent_uuid: null,
      uuid: ROOT_PARENT_MESSAGE_UUID,
    },
  };
}

/**
 * 基于摘要构建对话详情快照
 */
export function buildConversationDetailSnapshot({
  summary,
  title,
}: {
  summary: ChatConversationSummary;
  title?: string;
}): ChatConversationDetail {
  return {
    ...summary,
    mapping: createEmptyMapping(),
    title: title ?? summary.title,
  };
}

export function getConversationDisplayTitle(title: string | null | undefined) {
  const normalizedTitle = title?.trim();

  return normalizedTitle && normalizedTitle.length > 0
    ? normalizedTitle
    : FALLBACK_CONVERSATION_TITLE;
}
