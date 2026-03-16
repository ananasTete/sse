import type { ChatStatus } from "../models/chat";
import type { ConversationMapping } from "./conversation-domain-reducer";

export interface ActiveRequest {
  assistantMessageUuid: string;
  controller: AbortController;
}

export interface ConversationRuntimeState {
  activeRequest: ActiveRequest | null;
  active_child_uuid_by_parent_uuid: Record<string, string>;
  errorMessage: string | null;
  next_message_index: number;
  status: ChatStatus;
}

export function createInitialConversationRuntimeState(): ConversationRuntimeState {
  return {
    activeRequest: null,
    active_child_uuid_by_parent_uuid: {},
    errorMessage: null,
    next_message_index: 0,
    status: "ready",
  };
}

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

export function getNextMessageIndex(mapping: ConversationMapping) {
  return (
    Object.values(mapping).reduce(
      (maxIndex, node) => Math.max(maxIndex, node.message?.index ?? -1),
      -1,
    ) + 1
  );
}
