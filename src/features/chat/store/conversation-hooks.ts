import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  getMessageByUuid,
  selectBranchChildUuids,
  selectCurrentBranchMessages,
} from "../state/conversation-selectors";
import { useConversationStore } from "./conversation-store";

export const useHasConversation = (conversationId: string) => {
  return useConversationStore(
    (state) => Boolean(state.conversations[conversationId]),
  );
};

export const useConversationMessages = (conversationId: string) => {
  const conversation = useConversationStore(
    (state) => state.conversations[conversationId] ?? null,
  );

  return useMemo(() => {
    return conversation ? selectCurrentBranchMessages(conversation) : [];
  }, [conversation]);
};

export const useConversationSummary = (conversationId: string) => {
  return useConversationStore(
    useShallow((state) => {
      const conversation = state.conversations[conversationId];

      if (!conversation) {
        return null;
      }

      return {
        created_at: conversation.domain.created_at,
        current_leaf_message_uuid: conversation.domain.current_leaf_message_uuid,
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

export const useConversationErrorMessage = (conversationId: string) => {
  return useConversationStore(
    (state) => state.conversations[conversationId]?.runtime.errorMessage ?? null,
  );
};

export const useConversationStatus = (conversationId: string) => {
  return useConversationStore(
    (state) => state.conversations[conversationId]?.runtime.status ?? "ready",
  );
};

export const useBranchState = (
  conversationId: string,
  parentMessageUuid: string,
) => {
  const conversation = useConversationStore(
    (state) => state.conversations[conversationId] ?? null,
  );

  return useMemo(() => {
    return conversation
      ? selectBranchChildUuids(conversation, parentMessageUuid)
      : [];
  }, [conversation, parentMessageUuid]);
};

export const useMessage = (conversationId: string, messageUuid: string) => {
  return useConversationStore((state) => {
    const conversation = state.conversations[conversationId];
    return conversation ? getMessageByUuid(conversation, messageUuid) : null;
  });
};
