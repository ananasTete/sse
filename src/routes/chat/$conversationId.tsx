import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useLayoutEffect } from "react";
import { ConversationView } from "#/features/chat/components";
import {
  conversationKeys,
  fetchChatConversationDetail,
  upsertConversationListCache,
} from "#/features/chat/api";
import { useConversationStore } from "#/features/conversation/core/conversation-store";
import {
  useConversationSummary,
  useHasConversation,
} from "#/features/conversation";

export const Route = createFileRoute("/chat/$conversationId")({
  component: ConversationPage,
});

function ConversationPage() {
  const { conversationId } = Route.useParams();
  const queryClient = useQueryClient();
  const hasConversation = useHasConversation(conversationId);
  const summary = useConversationSummary(conversationId);
  const hydrateConversation = useConversationStore(
    (state) => state.hydrateConversation,
  );

  const { data, error, isLoading } = useQuery({
    queryFn: () => fetchChatConversationDetail(conversationId),
    queryKey: conversationKeys.detail(conversationId),
    enabled: !hasConversation, // 新会话会创建 conversation 快照，跳转到页面时不会请求详情
  });

  // 请求到会话详情后，同步到 store 中
  useEffect(() => {
    if (!hasConversation && data) {
      hydrateConversation(data);
    }
  }, [data, hasConversation, hydrateConversation]);

  // 会话摘要变化时同步到 sidebar 的列表缓存，title、update_at 变化时会触发
  useEffect(() => {
    if (!summary) {
      return;
    }
    upsertConversationListCache(queryClient, summary);
  }, [queryClient, summary]);

  // 已在 store 中 → 直接渲染
  if (hasConversation) {
    return <ConversationView conversationId={conversationId} />;
  }

  // 正在请求 or data 已到但还在等待 hydrate → loading
  if (isLoading || data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-sea-ink-soft">
        Loading conversation...
      </div>
    );
  }

  // 请求结束且无数据 → 错误 / 不存在
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div className="max-w-md space-y-3">
        <div className="font-['Fraunces'] text-3xl text-sea-ink">
          Conversation unavailable
        </div>
        <p className="text-sm leading-7 text-sea-ink-soft">
          {error instanceof Error ? error.message : "Conversation not found."}
        </p>
      </div>
    </div>
  );
}
