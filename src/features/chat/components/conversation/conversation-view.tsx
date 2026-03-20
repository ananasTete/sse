import { AlertCircle, MessageSquarePlus } from "lucide-react";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { DEFAULT_MODEL } from "../../../conversation/models/constants";
import { useConversationStore } from "../../../conversation/store/conversation-store";
import {
  useConversationErrorMessage,
  useConversationMessages,
  useConversationStatus,
} from "../../../conversation/hooks";
import { ConversationComposer } from "./conversation-composer";
import { UserMessageView } from "./user-message-view";
import { AssistantMessageView } from "./assistant-message-view";
import type { UIMessage } from "../../../conversation/models/ui";

export function ConversationView({
  conversationId,
}: {
  conversationId: string;
}) {
  const status = useConversationStatus(conversationId);
  const errorMessage = useConversationErrorMessage(conversationId);
  const messages = useConversationMessages(conversationId);

  const {
    editUserMessage,
    regenerate,
    regenerateUserMessage,
    selectBranch,
    sendMessage,
    stop,
  } = useConversationStore(
    useShallow((state) => ({
      editUserMessage: state.editUserMessage,
      regenerate: state.regenerate,
      regenerateUserMessage: state.regenerateUserMessage,
      selectBranch: state.selectBranch,
      sendMessage: state.sendMessage,
      stop: state.stop,
    })),
  );

  const isBusy = status === "streaming" || status === "submitted";

  const handleSubmit = useCallback(
    async ({ model, prompt }: { model: string; prompt: string }) => {
      await sendMessage(conversationId, { model, prompt });
    },
    [conversationId, sendMessage],
  );

  const handleConfirmEdit = useCallback(
    async (message: UIMessage, prompt: string) => {
      await editUserMessage(conversationId, message.uuid, {
        model: message.model ?? DEFAULT_MODEL,
        prompt,
      });
    },
    [conversationId, editUserMessage],
  );

  const handleRegenerate = useCallback(
    async (assistantMessageUuid: string) => {
      await regenerate(conversationId, assistantMessageUuid);
    },
    [conversationId, regenerate],
  );

  const handleRegenerateUserMessage = useCallback(
    async (userMessageUuid: string) => {
      await regenerateUserMessage(conversationId, userMessageUuid);
    },
    [conversationId, regenerateUserMessage],
  );

  const handleBranchSelect = useCallback(
    (messageUuid: string) => {
      void selectBranch(conversationId, messageUuid);
    },
    [conversationId, selectBranch],
  );

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {errorMessage ? (
          <div className="border-b border-error-border bg-error-bg px-5 py-3 text-sm text-sea-ink">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-error-fg" />
              <p className="leading-6">{errorMessage}</p>
            </div>
          </div>
        ) : null}

        <div
          className="flex-1 space-y-4 overflow-y-auto px-5 py-5"
        >
          {messages.length ? (
            messages.map((message) => (
              <article
                className={
                  message.role === "assistant"
                    ? "flex w-full justify-start"
                    : "flex w-full justify-end"
                }
                key={message.uuid}
              >
                {message.role === "user" ? (
                  <UserMessageView
                    isBusy={isBusy}
                    message={message}
                    onBranchSelect={handleBranchSelect}
                    onConfirmEdit={handleConfirmEdit}
                    onRegenerate={handleRegenerateUserMessage}
                  />
                ) : (
                  <AssistantMessageView
                    isBusy={isBusy}
                    message={message}
                    onBranchSelect={handleBranchSelect}
                    onRegenerate={handleRegenerate}
                  />
                )}
              </article>
            ))
          ) : (
            <div className="flex min-h-full flex-col items-center justify-center gap-3 py-12 text-center">
              <div className="flex size-12 items-center justify-center border border-line bg-surface-strong text-sea-ink-soft">
                <MessageSquarePlus className="size-5" />
              </div>
              <p className="max-w-xs text-xs leading-5 text-sea-ink-soft">
                Type a message below to begin. You can ask questions, request
                code, or start any kind of discussion.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-line bg-surface-strong p-4">
          <ConversationComposer
            isPending={isBusy}
            onStop={() => {
              void stop(conversationId);
            }}
            onSubmit={handleSubmit}
          />
        </div>
      </div>
    </section>
  );
}
