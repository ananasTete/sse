/**
 * Pure read functions that derive data from ConversationState.
 * All selectors are side-effect free and depend only on their arguments.
 */

import type { ChatContent, ChatStatus } from "../models/message";
import type { ChatConversationDetail } from "../models/conversation";
import type { BranchInfo, UIMessage } from "../models/ui";

function getTextContent(blocks: ChatContent[]) {
  return blocks
    .filter(
      (
        block,
      ): block is Extract<ChatContent, { type: "text" }> =>
        block != null && block.type === "text",
    )
    .map((block) => block.text)
    .join("");
}

export function getMessagePlainText(blocks: ChatContent[]) {
  const text = getTextContent(blocks).trim();
  return text || " ";
}

type ConversationReadState = {
  domain: Pick<
    ChatConversationDetail & {
      active_child_uuid_by_parent_uuid: Record<string, string>;
    },
    "current_leaf_message_uuid" | "mapping" | "active_child_uuid_by_parent_uuid"
  >;
  runtime: Pick<{ status: ChatStatus }, "status">;
};


export function selectCurrentBranchMessages(
  conversation: ConversationReadState,
): UIMessage[] {
  const messages: UIMessage[] = [];
  const isConversationBusy =
    conversation.runtime.status === "submitted" ||
    conversation.runtime.status === "streaming";
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
        isStreaming: false,
        plainText: getMessagePlainText(currentNode.message.content),
      });
    }

    currentMessageUuid = currentNode.parent_uuid;
  }

  const orderedMessages = messages.reverse();
  let lastAssistantIndex = -1;

  for (let index = orderedMessages.length - 1; index >= 0; index -= 1) {
    const message = orderedMessages[index];

    if (message?.role === "assistant" && message.stop_reason === null) {
      lastAssistantIndex = index;
      break;
    }
  }

  return orderedMessages.map((message, index) => ({
    ...message,
    isStreaming:
      isConversationBusy &&
      message.role === "assistant" &&
      index === lastAssistantIndex,
  }));
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
