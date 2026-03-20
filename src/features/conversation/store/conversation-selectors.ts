/**
 * Pure read functions that derive data from ConversationState.
 * All selectors are side-effect free and depend only on their arguments.
 */

import type { ChatConversationDetail } from "../models/conversation";
import type { BranchInfo, UIMessage } from "../models/ui";

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


export function selectCurrentBranchMessages(
  conversation: ConversationReadState,
): UIMessage[] {
  const messages: UIMessage[] = [];
  const streamingMessageUuid =
    conversation.runtime.activeRequest?.assistantMessageUuid ?? null;
  let currentMessageUuid = conversation.domain.current_leaf_message_uuid;

  while (currentMessageUuid) {
    const currentNode = conversation.domain.mapping[currentMessageUuid];

    if (!currentNode) {
      break;
    }

    if (currentNode.message) {
      let branchInfo: BranchInfo | null = null;

      const parentUuid = currentNode.parent_uuid;
      const parentNode = parentUuid
        ? conversation.domain.mapping[parentUuid]
        : null;

      if (parentNode && parentNode.child_uuids.length > 0) {
        const childUuids = parentNode.child_uuids;
        const branchIndex = childUuids.indexOf(currentMessageUuid);

        branchInfo = {
          branchCount: childUuids.length,
          branchIndex,
          nextBranchUuid:
            branchIndex < childUuids.length - 1
              ? childUuids[branchIndex + 1]
              : null,
          previousBranchUuid:
            branchIndex > 0 ? childUuids[branchIndex - 1] : null,
        };
      }

      messages.push({
        ...currentNode.message,
        branchInfo,
        isStreaming: currentNode.message.uuid === streamingMessageUuid,
      });
    }

    currentMessageUuid = currentNode.parent_uuid;
  }

  return messages.reverse();
}

export function selectBranchChildUuids(
  conversation: ConversationReadState,
  parentMessageUuid: string,
) {
  return [...(conversation.domain.mapping[parentMessageUuid]?.child_uuids ?? [])];
}

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
