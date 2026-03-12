import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { ConversationView } from '#/features/chat/components/conversation-view'
import {
  conversationKeys,
  fetchChatConversationDetail,
} from '#/features/chat/conversation-client'
import type { ChatConversationDetail } from '#/features/chat/conversation-model'
import { consumePendingInitialSubmission } from '#/features/chat/pending-initial-submission'

export const Route = createFileRoute('/chat/$conversationId')({
  component: ConversationPage,
})

function ConversationPage() {
  const { conversationId } = Route.useParams()
  const queryClient = useQueryClient()
  const [initialSubmission] = useState(() =>
    consumePendingInitialSubmission(conversationId),
  )
  const seededDetail = queryClient.getQueryData<ChatConversationDetail>(
    conversationKeys.detail(conversationId),
  )
  const shouldSkipInitialFetch = Boolean(initialSubmission && seededDetail)
  const { data, error, isLoading } = useQuery({
    enabled: !shouldSkipInitialFetch,
    initialData: shouldSkipInitialFetch ? seededDetail : undefined,
    queryFn: () => fetchChatConversationDetail(conversationId),
    queryKey: conversationKeys.detail(conversationId),
  })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--sea-ink-soft)]">
        Loading conversation...
      </div>
    )
  }

  if (error || !data) {
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
      initialSubmission={initialSubmission}
      title={data.title}
    />
  )
}
