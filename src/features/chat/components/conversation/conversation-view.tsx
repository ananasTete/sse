import { AlertCircle, MessageSquarePlus } from "lucide-react";
import {
  useConversationErrorMessage,
  useConversationStatus,
  useCurrentBranchMessageUuids,
} from "../../../conversation/hooks";
import { ConversationComposer } from "./conversation-composer";
import { UserMessageView } from "./user-message-view";
import { AssistantMessageView } from "./assistant-message-view";
import { useMessage } from "../../../conversation/hooks";
import { useConversationStore } from "#/features/conversation/store/conversation-store";

function MessageItem({
  conversationId,
  isBusy,
  messageUuid,
}: {
  conversationId: string;
  isBusy: boolean;
  messageUuid: string;
}) {
  const message = useMessage(conversationId, messageUuid);

  if (!message) {
    return null;
  }

  return (
    <article
      className={
        message.role === "assistant"
          ? "flex w-full justify-start"
          : "flex w-full justify-end"
      }
    >
      {message.role === "user" ? (
        <UserMessageView
          conversationId={conversationId}
          isBusy={isBusy}
          messageUuid={messageUuid}
        />
      ) : (
        <AssistantMessageView
          conversationId={conversationId}
          isBusy={isBusy}
          messageUuid={messageUuid}
        />
      )}
    </article>
  );
}

export function ConversationView({
  conversationId,
}: {
  conversationId: string;
}) {
  const status = useConversationStatus(conversationId);
  const errorMessage = useConversationErrorMessage(conversationId);
  const messageUuids = useCurrentBranchMessageUuids(conversationId);
  const sendMessage = useConversationStore((state) => state.sendMessage);
  const stop = useConversationStore((state) => state.stop);

  const isPending = status === "streaming" || status === "submitted";

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

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {messageUuids.length ? (
            messageUuids.map((uuid) => (
              <MessageItem
                conversationId={conversationId}
                isBusy={isPending}
                key={uuid}
                messageUuid={uuid}
              />
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
            isPending={isPending}
            onStop={() => void stop(conversationId)}
            onSubmit={(args) => void sendMessage(conversationId, args)}
          />
        </div>
      </div>
    </section>
  );
}
