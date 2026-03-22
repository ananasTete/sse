import { RotateCcw } from "lucide-react";
import { useState } from "react";
import {
  useConversationActions,
  useIsStreamingMessage,
  useMessage,
  useSiblingUuids,
} from "../../../conversation/hooks";
import { BranchNavigator } from "./branch-navigator";
import { MessageContent } from "../message";

interface AssistantMessageViewProps {
  conversationId: string;
  messageUuid: string;
}

export function AssistantMessageView({
  conversationId,
  messageUuid,
}: AssistantMessageViewProps) {

  const message = useMessage(conversationId, messageUuid);
  const siblingUuids = useSiblingUuids(conversationId, messageUuid);
  const isStreaming = useIsStreamingMessage(conversationId, messageUuid);

  const { retryFromAssistantMessage, selectBranch } = useConversationActions();

  const [expandedToolBlocks, setExpandedToolBlocks] = useState<
    Record<string, boolean>
  >({});

  const handleToggleToolBlock = (toolUseId: string) => {
    setExpandedToolBlocks((current) => ({
      ...current,
      [toolUseId]: !(current[toolUseId] ?? false),
    }));
  };

  if (!message) {
    return null;
  }

  return (
    <div className="max-w-[min(42rem,92%)] border border-line bg-surface-strong px-4 py-3">
      <MessageContent
        blocks={message.content}
        expandedToolBlocks={expandedToolBlocks}
        isStreamingMessage={isStreaming}
        onToggleToolBlock={handleToggleToolBlock}
      />

      <div className="mt-3 flex items-center gap-3 border-t border-line pt-3 text-[0.72rem] text-sea-ink-soft">
        <button
          className="inline-flex items-center gap-1 transition hover:text-sea-ink"
          onClick={() => {
            retryFromAssistantMessage(conversationId, messageUuid);
          }}
          type="button"
        >
          <RotateCcw className="size-3.5" />
          Regenerate
        </button>

        {siblingUuids ? (
          <BranchNavigator
            siblingUuids={siblingUuids}
            currentUuid={messageUuid}
            disabled={false}
            onSelect={(uuid) => void selectBranch(conversationId, uuid)}
          />
        ) : null}
      </div>
    </div>
  );
}
