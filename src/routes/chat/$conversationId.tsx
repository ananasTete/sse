import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ConversationView } from '#/features/chat/components'
import {
  conversationKeys,
  fetchChatConversationDetail,
  upsertConversationListCache,
} from '#/features/chat/api'
import { useConversationStore } from '#/features/chat/store/conversation-store'
import {
  useConversationSummary,
  useHasConversation,
} from '#/features/chat/hooks'
import { useEffect } from 'react'

export const Route = createFileRoute('/chat/$conversationId')({
  component: ConversationPage,
})

function ConversationPage() {
  const { conversationId } = Route.useParams()
  const queryClient = useQueryClient()
  const hasConversation = useHasConversation(conversationId)
  const summary = useConversationSummary(conversationId)
  const hydrateConversation = useConversationStore((state) => state.hydrateConversation)

  const { data, error, isLoading } = useQuery({
    queryFn: () => fetchChatConversationDetail(conversationId),
    queryKey: conversationKeys.detail(conversationId),
    enabled: !hasConversation,
    staleTime: 1000 * 10,
  })

  useEffect(() => {
    if (!hasConversation && data) {
      hydrateConversation(data)
    }
  }, [data, hasConversation, hydrateConversation])

  useEffect(() => {
    if (!summary) {
      return
    }

    upsertConversationListCache(queryClient, summary)
  }, [queryClient, summary])

  if (hasConversation) {
    return <ConversationView conversationId={conversationId} />
  }

  if (isLoading || data) {
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
    <ConversationView conversationId={conversationId} />
  )
}
