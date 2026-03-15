import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ConversationView } from '#/features/chat/components'
import {
  conversationKeys,
  fetchChatConversationDetail,
  upsertConversationListCache,
} from '#/features/chat/api'
import { useChatStore } from '#/features/chat/store/chat-store'
import { useEffect } from 'react'

export const Route = createFileRoute('/chat/$conversationId')({
  component: ConversationPage,
})

function ConversationPage() {
  const { conversationId } = Route.useParams()
  const queryClient = useQueryClient()
  const detailQueryKey = conversationKeys.detail(conversationId)
  
  // 如果会话在 Store 中正处于发送/生成状态，说明是新创建并立刻跳转进来的，
  // 或者正在生成中，此时不需要向后端拉取详情，避免旧数据覆盖。
  const chatStatus = useChatStore(state => state.conversations[conversationId]?.status)
  const isBusy = chatStatus === 'submitted' || chatStatus === 'streaming'

  const { data, error, isLoading } = useQuery({
    queryFn: () => fetchChatConversationDetail(conversationId),
    queryKey: detailQueryKey,
    enabled: !isBusy,
    staleTime: 1000 * 10, // 给一点缓存新鲜度，避免跳转时立刻 fallback 请求
  })

  const resumeStream = useChatStore(state => state.resumeStream)

  // Check if there's an incomplete stream and resume it
  useEffect(() => {
    if (data && data.current_leaf_message_uuid) {
      // Find the last assistant message
      const lastMessage = Object.values(data.mapping)
        .map(node => node.message)
        .filter((msg): msg is NonNullable<typeof msg> => msg !== null)
        .reverse()
        .find(msg => msg.role === 'assistant' && msg.stop_reason === null)

      if (lastMessage) {
        console.log('Found incomplete stream, resuming:', lastMessage.uuid)
        resumeStream(conversationId, lastMessage.uuid)
      }
    }
  }, [data, conversationId, resumeStream])

  const refreshConversationCaches = async () => {
    const detail = await queryClient.fetchQuery({
      queryFn: () => fetchChatConversationDetail(conversationId),
      queryKey: detailQueryKey,
    })

    upsertConversationListCache(queryClient, {
      created_at: detail.created_at,
      current_leaf_message_uuid: detail.current_leaf_message_uuid,
      title: detail.title,
      updated_at: detail.updated_at,
      uuid: detail.uuid,
    })
  }

  if (isLoading && !data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--sea-ink-soft)]">
        Loading conversation...
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="max-w-md space-y-3">
          <div className="font-['Fraunces'] text-3xl text-[var(--sea-ink)]">
            Conversation unavailable
          </div>
          <p className="text-sm leading-7 text-[var(--sea-ink-soft)]">
            {error instanceof Error ? error.message : 'Conversation not found.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <ConversationView
      key={conversationId}
      conversationId={conversationId}
      initialCurrentLeafMessageUuid={data.current_leaf_message_uuid}
      initialMapping={data.mapping}
      onConversationChanged={refreshConversationCaches}
      title={data.title}
    />
  )
}
