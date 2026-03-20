import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type {
  ChatConversationDetail,
  ChatConversationListResponse,
  ChatConversationSummary,
  CreateChatConversationInput,
} from "../../conversation/models/conversation";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const conversationKeys = {
  all: ["chatConversations"] as const,
  detail: (conversationId: string) =>
    ["chatConversations", "detail", conversationId] as const,
  list: () => ["chatConversations", "list"] as const,
  pendingSubmission: (conversationId: string) =>
    ["chatConversations", "pendingSubmission", conversationId] as const,
};

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

export function getChatConversationPath(conversationId: string) {
  return `/api/chat_conversations/${conversationId}`;
}

export function getChatCompletionPath(conversationId: string) {
  return `${getChatConversationPath(conversationId)}/completion`;
}

export function getChatConversationCancelPath(conversationId: string) {
  return `${getChatConversationPath(conversationId)}/cancel`;
}

// ---------------------------------------------------------------------------
// HTTP fetch functions
// ---------------------------------------------------------------------------

async function readJson<T>(response: Response) {
  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;

    try {
      const payload = (await response.json()) as { error?: string };

      if (payload.error) {
        message = payload.error;
      }
    } catch {}

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function createChatConversation(
  input: CreateChatConversationInput & { signal?: AbortSignal },
) {
  const { signal, ...payload } = input;
  const response = await fetch("/api/chat_conversations", {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
    signal,
  });

  return readJson<ChatConversationSummary>(response);
}

export async function fetchChatConversationDetail(conversationId: string) {
  const response = await fetch(getChatConversationPath(conversationId));

  return readJson<ChatConversationDetail>(response);
}

export async function updateChatConversationCurrentLeaf(
  conversationId: string,
  currentLeafMessageUuid: string | null,
) {
  const response = await fetch(getChatConversationPath(conversationId), {
    body: JSON.stringify({
      current_leaf_message_uuid: currentLeafMessageUuid,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });

  return readJson<ChatConversationSummary>(response);
}

export async function fetchChatConversationList({
  cursor,
}: {
  cursor?: string;
}) {
  const searchParams = new URLSearchParams();

  if (cursor) {
    searchParams.set("cursor", cursor);
  }

  const queryString = searchParams.toString();
  const response = await fetch(
    queryString
      ? `/api/chat_conversations?${queryString}`
      : "/api/chat_conversations",
  );

  return readJson<ChatConversationListResponse>(response);
}

// ---------------------------------------------------------------------------
// React Query cache helpers
// ---------------------------------------------------------------------------

export function upsertConversationListCache(
  queryClient: QueryClient,
  summary: ChatConversationSummary,
) {
  queryClient.setQueryData<
    InfiniteData<ChatConversationListResponse, string | undefined> | undefined
  >(conversationKeys.list(), (current) => {
    if (!current) {
      return {
        pageParams: [undefined],
        pages: [
          {
            has_more: false,
            items: [summary],
            next_cursor: null,
          },
        ],
      };
    }

    // Check if the conversation already exists in any page
    const existsInList = current.pages.some((page) =>
      page.items.some((item) => item.uuid === summary.uuid),
    );

    if (existsInList) {
      // Update in-place, preserving the original position
      return {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          items: page.items.map((item) =>
            item.uuid === summary.uuid ? summary : item,
          ),
        })),
      };
    }

    // New conversation: insert at the top of the first page
    const [firstPage, ...restPages] = current.pages;

    if (!firstPage) {
      return current;
    }

    return {
      ...current,
      pages: [
        {
          ...firstPage,
          items: [summary, ...firstPage.items],
        },
        ...restPages,
      ],
    };
  });
}
