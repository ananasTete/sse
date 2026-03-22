import { useShallow } from "zustand/react/shallow";
import { selectSiblingUuids } from "./conversation-selectors";
import {
  getMessageByUuid,
  useConversationStore,
} from "./conversation-store";

const EMPTY_MESSAGE_UUIDS: string[] = [];

// 检查会话是否存在
export const useHasConversation = (conversationId: string) => {
  return useConversationStore((state) =>
    Boolean(state.conversations[conversationId]),
  );
};

// 获取会话状态
export const useConversationStatus = (conversationId: string) => {
  return useConversationStore(
    (state) => state.conversations[conversationId]?.runtime.status ?? "ready",
  );
};

// 获取会话错误信息
export const useConversationErrorMessage = (conversationId: string) => {
  return useConversationStore(
    (state) =>
      state.conversations[conversationId]?.runtime.errorMessage ?? null,
  );
};

// 获取会话 action
export const useConversationActions = () => {
  return useConversationStore(
    useShallow((state) => ({
      editAndResend: state.editAndResend,
      retryFromAssistantMessage: state.retryFromAssistantMessage,
      retryFromUserMessage: state.retryFromUserMessage,
      selectBranch: state.selectBranch,
      sendMessage: state.sendMessage,
      stop: state.stop,
    })),
  );
};

// 获取会话当前分支的消息 UUID 列表（只关心树结构，低频变化）
export const useCurrentBranchMessageUuids = (conversationId: string) => {
  return useConversationStore(
    (state) =>
      state.conversations[conversationId]?.domain.current_branch_message_uuids ??
      EMPTY_MESSAGE_UUIDS,
  );
};

// 获取单条消息
export const useMessage = (conversationId: string, messageUuid: string) => {
  return useConversationStore((state) => {
    const conversation = state.conversations[conversationId];
    return conversation ? getMessageByUuid(conversation, messageUuid) : null;
  });
};

// 只获取消息的 role（原始值，流式 delta 不会改变 role，引用天然稳定）
export const useMessageRole = (conversationId: string, messageUuid: string) => {
  return useConversationStore(
    (state) =>
      state.conversations[conversationId]?.domain.mapping[messageUuid]?.message
        ?.role ?? null,
  );
};

// 获取某条消息的兄弟节点列表（直接返回 store 中的引用，利用 Immer 结构共享保证稳定性）
export const useSiblingUuids = (
  conversationId: string,
  messageUuid: string,
) => {
  return useConversationStore((state) => {
    const conversation = state.conversations[conversationId];
    return conversation
      ? selectSiblingUuids(conversation, messageUuid)
      : null;
  });
};

// 判断某条消息是否正在流式传输（返回原始值 boolean，极低频变化）
export const useIsStreamingMessage = (
  conversationId: string,
  messageUuid: string,
) => {
  return useConversationStore(
    (state) =>
      state.conversations[conversationId]?.runtime.activeRequest
        ?.assistantMessageUuid === messageUuid,
  );
};

// 获取会话摘要
export const useConversationSummary = (conversationId: string) => {
  return useConversationStore(
    useShallow((state) => {
      const conversation = state.conversations[conversationId];

      if (!conversation) {
        return null;
      }

      return {
        created_at: conversation.domain.created_at,
        current_leaf_message_uuid:
          conversation.domain.current_leaf_message_uuid,
        title: conversation.domain.title,
        updated_at: conversation.domain.updated_at,
        uuid: conversationId,
      };
    }),
  );
};

export const useConversationTitle = (conversationId: string) => {
  return useConversationStore(
    (state) => state.conversations[conversationId]?.domain.title ?? "",
  );
};
