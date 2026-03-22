import { describe, expect, it } from "vitest";
import { produce } from "immer";

import { ROOT_PARENT_MESSAGE_UUID } from "../models/constants";
import type { NewChatMessage } from "../models/message";
import {
  createEmptyConversationDomain,
  applyConversationAction,
} from "../store/conversation-reducer";
import { selectCurrentBranchMessageUuids } from "../store/conversation-selectors";

function createMessage({
  parent_uuid,
  role,
  text,
  uuid,
}: {
  parent_uuid: string;
  role: "assistant" | "user";
  text: string;
  uuid: string;
}): NewChatMessage {
  return {
    content: [
      {
        citations: [],
        start_timestamp: "2026-03-22T10:00:00.000Z",
        stop_timestamp: null,
        text,
        type: "text",
      },
    ],
    created_at: "2026-03-22T10:00:00.000Z",
    files: [],
    metadata: {},
    model: "claude-sonnet-4-6",
    parent_uuid,
    role,
    stop_reason: null,
    updated_at: "2026-03-22T10:00:00.000Z",
    uuid,
  };
}

describe("current branch message uuid cache", () => {
  it("keeps the cached uuid list reference stable across text deltas", () => {
    let domain = createEmptyConversationDomain(
      "conversation-1",
      "2026-03-22T10:00:00.000Z",
    );

    domain = produce(domain, (draft) => {
      applyConversationAction(draft, {
        message: createMessage({
          parent_uuid: ROOT_PARENT_MESSAGE_UUID,
          role: "user",
          text: "hello",
          uuid: "user-1",
        }),
        type: "message-appended",
      });
    });

    domain = produce(domain, (draft) => {
      applyConversationAction(draft, {
        message: createMessage({
          parent_uuid: "user-1",
          role: "assistant",
          text: "hi",
          uuid: "assistant-1",
        }),
        type: "message-appended",
      });
    });

    const cachedBeforeDelta = domain.current_branch_message_uuids;

    expect(cachedBeforeDelta).toEqual(["user-1", "assistant-1"]);
    expect(
      selectCurrentBranchMessageUuids({
        domain,
      }),
    ).toBe(cachedBeforeDelta);

    const nextDomain = produce(domain, (draft) => {
      applyConversationAction(draft, {
        index: 0,
        messageUuid: "assistant-1",
        text: " there",
        type: "text-block-delta-received",
      });
    });

    expect(nextDomain.current_branch_message_uuids).toBe(cachedBeforeDelta);
    expect(
      selectCurrentBranchMessageUuids({
        domain: nextDomain,
      }),
    ).toBe(cachedBeforeDelta);
  });

  it("recomputes the cached uuid list when the selected branch changes", () => {
    let domain = createEmptyConversationDomain(
      "conversation-2",
      "2026-03-22T10:00:00.000Z",
    );

    domain = produce(domain, (draft) => {
      applyConversationAction(draft, {
        message: createMessage({
          parent_uuid: ROOT_PARENT_MESSAGE_UUID,
          role: "user",
          text: "hello",
          uuid: "user-1",
        }),
        type: "message-appended",
      });
    });

    domain = produce(domain, (draft) => {
      applyConversationAction(draft, {
        message: createMessage({
          parent_uuid: "user-1",
          role: "assistant",
          text: "first branch",
          uuid: "assistant-1",
        }),
        type: "message-appended",
      });
    });

    domain = produce(domain, (draft) => {
      applyConversationAction(draft, {
        message: createMessage({
          parent_uuid: "user-1",
          role: "assistant",
          text: "second branch",
          uuid: "assistant-2",
        }),
        type: "message-appended",
      });
    });

    const cachedBeforeSelection = domain.current_branch_message_uuids;

    expect(cachedBeforeSelection).toEqual(["user-1", "assistant-2"]);

    const nextDomain = produce(domain, (draft) => {
      applyConversationAction(draft, {
        messageUuid: "assistant-1",
        type: "branch-selected",
      });
    });

    expect(nextDomain.current_branch_message_uuids).toEqual([
      "user-1",
      "assistant-1",
    ]);
    expect(nextDomain.current_branch_message_uuids).not.toBe(
      cachedBeforeSelection,
    );
  });
});
