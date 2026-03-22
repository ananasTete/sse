import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { v7 as generateTimeOrderedUuid } from "uuid";
import {
  applyConversationAction,
  createEmptyConversationDomain,
  deriveCurrentBranchMessageUuids,
  type ConversationAction,
  type ConversationDomainState,
} from "./conversation-reducer";
import {
  createInitialConversationRuntimeState,
  type ActiveRequest,
  type ConversationRuntimeState,
} from "./conversation-runtime";

import { createUserMessage } from "./message-builders";
import { processChatCompletionStream } from "../streaming/completion-stream";
import { getISOTimestamp } from "../utils/time";
import { DEFAULT_MODEL, ROOT_PARENT_MESSAGE_UUID } from "../models/constants";
import type { ChatConversationDetail } from "../models/conversation";
import type {
  ChatCompletionRequest,
  EditUserMessageInput,
  RegenerateMessageInput,
  SendMessageInput,
} from "../models/requests";
import {
  getChatCompletionPath,
  getChatConversationCancelPath,
  updateChatConversationCurrentLeaf,
} from "#/features/chat/api";

// ==========================================
// 内部工具函数
// ==========================================

// 获取某条消息（store action 和 hooks 共用）
export function getMessageByUuid(
  conversation: { domain: Pick<ConversationDomainState, "mapping"> },
  messageUuid: string,
) {
  return conversation.domain.mapping[messageUuid]?.message ?? null;
}

// 查找未完成的流式消息（仅 hydrateConversation 内部使用）
function findIncompleteStreamMessageUuid(
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

export interface ConversationState {
  domain: ConversationDomainState;
  runtime: ConversationRuntimeState;
}

interface ConversationStore {
  conversations: Record<string, ConversationState>;

  editAndResend: (
    conversationId: string,
    userMessageUuid: string,
    input: EditUserMessageInput,
  ) => Promise<void>;
  hydrateConversation: (detail: ChatConversationDetail) => void;
  retryFromAssistantMessage: (
    conversationId: string,
    assistantMessageUuid: string,
    input?: RegenerateMessageInput,
  ) => Promise<void>;
  retryFromUserMessage: (
    conversationId: string,
    userMessageUuid: string,
    input?: RegenerateMessageInput,
  ) => Promise<void>;
  selectBranch: (conversationId: string, messageUuid: string) => Promise<void>;
  sendMessage: (
    conversationId: string,
    input: SendMessageInput,
  ) => Promise<void>;
  stop: (conversationId: string) => Promise<void>;
}

function createConversationState(
  detail: ChatConversationDetail,
): ConversationState {
  return {
    domain: {
      ...detail,
      current_branch_message_uuids: deriveCurrentBranchMessageUuids(detail),
    },
    runtime: createInitialConversationRuntimeState(),
  };
}

function createEmptyConversationState(
  conversationId: string,
): ConversationState {
  const timestamp = getISOTimestamp();
  const domain = createEmptyConversationDomain(conversationId, timestamp);

  return {
    domain,
    runtime: createInitialConversationRuntimeState(),
  };
}

function isConversationBusy(
  runtime?: Pick<ConversationRuntimeState, "activeRequest" | "status"> | null,
) {
  return (
    runtime?.status === "submitted" ||
    runtime?.status === "streaming" ||
    runtime?.activeRequest != null
  );
}

export const useConversationStore = create<ConversationStore>()(
  immer((set, get) => {
    // 如果会话不存在就创建它
    const ensureConversation = (conversationId: string) => {
      if (!get().conversations[conversationId]) {
        set((draft) => {
          draft.conversations[conversationId] =
            createEmptyConversationState(conversationId);
        });
      }

      return get().conversations[conversationId];
    };

    // 更新会话前判断是否存在
    const withConversation = (
      conversationId: string,
      updater: (conversation: ConversationState) => void,
    ) => {
      set((draft) => {
        const conversation = draft.conversations[conversationId];

        if (!conversation) {
          return;
        }

        updater(conversation);
      });
    };

    // 清除正在进行中的请求数据
    const clearActiveRequest = (
      conversationId: string,
      controller: AbortController,
    ) => {
      withConversation(conversationId, (conversation) => {
        if (conversation.runtime.activeRequest?.controller === controller) {
          conversation.runtime.activeRequest = null;
        }
      });
    };

    // 设置正在进行中的请求，用于取消请求
    const setActiveRequest = (
      conversationId: string,
      request: ActiveRequest,
    ) => {
      withConversation(conversationId, (conversation) => {
        conversation.runtime.activeRequest = request;
        conversation.runtime.errorMessage = null;
      });
    };

    const setConversationError = (
      conversationId: string,
      errorMessage: string,
    ) => {
      withConversation(conversationId, (conversation) => {
        conversation.runtime.errorMessage = errorMessage;
        conversation.runtime.status = "error";
      });
    };

    // 分发更新 domain 数据的 action，domain 状态机的唯一入口
    const dispatchDomain = (
      conversationId: string,
      action: ConversationAction,
    ) => {
      set((draft) => {
        const conversation = draft.conversations[conversationId];

        if (!conversation) {
          return;
        }

        applyConversationAction(conversation.domain, action);
      });
    };

    const runStream = async ({
      assistantMessageUuid,
      conversationId,
      request,
    }: {
      assistantMessageUuid: string;
      conversationId: string;
      request: (controller: AbortController) => Promise<Response>;
    }) => {
      const controller = new AbortController();

      // 表示正在进行中请求，用于取消请求
      setActiveRequest(conversationId, {
        assistantMessageUuid,
        controller,
      });

      try {
        const response = await request(controller);

        await processChatCompletionStream({
          response,
          dispatch: (action) => dispatchDomain(conversationId, action),
          onAssistantMessageStarted: () => {
            withConversation(conversationId, (conversation) => {
              conversation.runtime.status = "streaming";
            });
          },
        });

        // 设置状态为结束
        withConversation(conversationId, (conversation) => {
          conversation.runtime.status = "ready";
          conversation.runtime.errorMessage = null;
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        const errorMessage =
          error instanceof Error
            ? error.message
            : "Chat completion stream failed.";

        setConversationError(conversationId, errorMessage);
        throw error instanceof Error ? error : new Error(errorMessage);
      } finally {
        clearActiveRequest(conversationId, controller);
      }
    };

    const cancelStream = async (conversationId: string, messageId: string) => {
      const stoppedAt = getISOTimestamp();

      try {
        const response = await fetch(
          getChatConversationCancelPath(conversationId),
          {
            body: JSON.stringify({ message_id: messageId }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          },
        );

        if (!response.ok) {
          throw new Error("Failed to cancel stream");
        }

        dispatchDomain(conversationId, {
          messageUuid: messageId,
          stoppedAt,
          type: "message-stream-stopped",
        });

        withConversation(conversationId, (conversation) => {
          if (
            conversation.runtime.activeRequest?.assistantMessageUuid ===
            messageId
          ) {
            conversation.runtime.activeRequest = null;
          }
          conversation.runtime.errorMessage = null;
          conversation.runtime.status = "ready";
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to cancel stream.";
        setConversationError(conversationId, errorMessage);
        throw error;
      }
    };

    const resumeStream = async (conversationId: string, messageId: string) => {
      const conversation = get().conversations[conversationId];

      if (!conversation) {
        return;
      }

      const message = getMessageByUuid(conversation, messageId);

      if (
        conversation.runtime.activeRequest?.assistantMessageUuid === messageId
      ) {
        return;
      }

      if (isConversationBusy(conversation.runtime)) {
        return;
      }

      if (message?.role !== "assistant" || message.stop_reason !== null) {
        return;
      }

      withConversation(conversationId, (draftConversation) => {
        draftConversation.runtime.status = "submitted";
      });

      await runStream({
        assistantMessageUuid: messageId,
        conversationId,
        request: async (controller) =>
          fetch(
            `/api/chat_conversations/${conversationId}/resume?message_id=${messageId}`,
            {
              signal: controller.signal,
            },
          ),
      });
    };

    return {
      conversations: {},

      // ==========================================
      // 发起和停止
      // ==========================================

      sendMessage: async (
        conversationId,
        {
          files = [],
          model,
          parentMessageUuid: inputParentMessageUuid,
          prompt,
        },
      ) => {
        // 创建会话
        const conversation = ensureConversation(conversationId);

        // 边界条件
        const normalizedPrompt = prompt.trim();
        const messageModel = model ?? DEFAULT_MODEL;

        if (!normalizedPrompt) {
          throw new Error("Prompt cannot be empty.");
        }

        if (isConversationBusy(conversation.runtime)) {
          throw new Error("A message is already being generated.");
        }

        const userMessageUuid = generateTimeOrderedUuid();
        const assistantMessageUuid = generateTimeOrderedUuid();
        const parentMessageUuid =
          inputParentMessageUuid ??
          conversation.domain.current_leaf_message_uuid ??
          ROOT_PARENT_MESSAGE_UUID;

        // 乐观更新用户消息
        dispatchDomain(conversationId, {
          message: createUserMessage({
            files,
            model: messageModel,
            parentMessageUuid,
            prompt: normalizedPrompt,
            uuid: userMessageUuid,
          }),
          type: "message-appended",
        });

        withConversation(conversationId, (draftConversation) => {
          draftConversation.runtime.status = "submitted";
          draftConversation.runtime.errorMessage = null;
        });

        await runStream({
          assistantMessageUuid,
          conversationId,
          request: async (controller) =>
            fetch(getChatCompletionPath(conversationId), {
              body: JSON.stringify({
                files,
                model: messageModel,
                parent_uuid: parentMessageUuid,
                prompt: normalizedPrompt,
                trigger: "submit",
                turn_message_uuids: {
                  assistant_message_uuid: assistantMessageUuid,
                  user_message_uuid: userMessageUuid,
                },
              } satisfies ChatCompletionRequest),
              headers: { "Content-Type": "application/json" },
              method: "POST",
              signal: controller.signal,
            }),
        });
      },

      stop: async (conversationId) => {
        const request =
          get().conversations[conversationId]?.runtime.activeRequest;

        if (!request) {
          return;
        }

        // 取消前端请求
        request.controller.abort();

        try {
          // 通知后端取消生成
          await cancelStream(conversationId, request.assistantMessageUuid);
        } finally {
          clearActiveRequest(conversationId, request.controller);
        }
      },

      // ==========================================
      // 重试
      // ==========================================

      retryFromUserMessage: async (conversationId, userMessageUuid, input) => {
        const conversation = get().conversations[conversationId];

        if (!conversation) {
          return;
        }

        if (isConversationBusy(conversation.runtime)) {
          throw new Error("A message is already being generated.");
        }

        const parentMessage = getMessageByUuid(conversation, userMessageUuid);

        if (!parentMessage || parentMessage.role !== "user") {
          throw new Error("Regenerate requires a user message.");
        }

        const nextAssistantMessageUuid = generateTimeOrderedUuid();

        withConversation(conversationId, (draftConversation) => {
          draftConversation.runtime.errorMessage = null;
          draftConversation.runtime.status = "submitted";
        });

        await runStream({
          assistantMessageUuid: nextAssistantMessageUuid,
          conversationId,
          request: async (controller) =>
            fetch(getChatCompletionPath(conversationId), {
              body: JSON.stringify({
                files: parentMessage.files,
                model: input?.model ?? parentMessage.model ?? DEFAULT_MODEL,
                parent_uuid: parentMessage.uuid,
                prompt: input?.prompt ?? "",
                trigger: "regenerate",
                turn_message_uuids: {
                  assistant_message_uuid: nextAssistantMessageUuid,
                },
              } satisfies ChatCompletionRequest),
              headers: { "Content-Type": "application/json" },
              method: "POST",
              signal: controller.signal,
            }),
        });
      },

      editAndResend: async (conversationId, userMessageUuid, input) => {
        const conversation = get().conversations[conversationId];

        if (!conversation) {
          return;
        }

        const userMessage = getMessageByUuid(conversation, userMessageUuid);

        if (!userMessage || userMessage.role !== "user") {
          throw new Error("Edit requires a user message.");
        }

        await get().sendMessage(conversationId, {
          files: userMessage.files,
          model: input.model,
          parentMessageUuid: userMessage.parent_uuid,
          prompt: input.prompt,
        });
      },

      retryFromAssistantMessage: async (
        conversationId,
        assistantMessageUuid,
        input,
      ) => {
        const conversation = get().conversations[conversationId];

        if (!conversation) {
          return;
        }

        const assistantMessage = getMessageByUuid(
          conversation,
          assistantMessageUuid,
        );

        if (!assistantMessage || assistantMessage.role !== "assistant") {
          throw new Error("Only assistant messages can be regenerated.");
        }

        await get().retryFromUserMessage(
          conversationId,
          assistantMessage.parent_uuid,
          {
            ...input,
            model: input?.model ?? assistantMessage.model,
          },
        );
      },

      // ==========================================
      // 分支
      // ==========================================

      selectBranch: async (conversationId, messageUuid) => {
        const conversation = get().conversations[conversationId];

        if (!conversation) {
          return;
        }

        if (isConversationBusy(conversation.runtime)) {
          throw new Error("A message is already being generated.");
        }

        dispatchDomain(conversationId, {
          messageUuid,
          type: "branch-selected",
        });

        try {
          await updateChatConversationCurrentLeaf(
            conversationId,
            get().conversations[conversationId]?.domain
              .current_leaf_message_uuid ?? null,
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : "Failed to persist branch selection.";
          setConversationError(conversationId, errorMessage);
        }
      },

      // ==========================================
      // 回放
      // ==========================================

      hydrateConversation: (detail) => {
        let shouldResume = false;
        let resumeMessageUuid: string | null = null;

        set((draft) => {
          if (draft.conversations[detail.uuid]) {
            return;
          }

          // 构建新 conversation
          draft.conversations[detail.uuid] = createConversationState(detail);
          // 判断最新消息是否未完成
          resumeMessageUuid = findIncompleteStreamMessageUuid(detail);
          shouldResume = resumeMessageUuid != null;
        });

        if (shouldResume && resumeMessageUuid) {
          void resumeStream(detail.uuid, resumeMessageUuid);
        }
      },
    };
  }),
);
