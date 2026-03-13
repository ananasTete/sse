import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { ConversationView } from '#/features/chat/components'
import {
  conversationKeys,
  fetchChatConversationDetail,
  shouldUsePendingConversationSeed,
  upsertConversationListCache,
} from '#/features/chat/api'
import type {
  ChatConversationDetail,
  PendingInitialConversationSubmission,
} from '#/features/chat/models'

export const Route = createFileRoute('/chat/$conversationId')({
  component: ConversationPage,
})

function ConversationPage() {
  const { conversationId } = Route.useParams()
  const queryClient = useQueryClient()
  const detailQueryKey = conversationKeys.detail(conversationId)
  const clearPendingInitialSubmission = () => {
    queryClient.removeQueries({
      exact: true,
      queryKey: conversationKeys.pendingSubmission(conversationId),
    })
  }
  const cachedDetail =
    queryClient.getQueryData<ChatConversationDetail>(detailQueryKey) ?? null
  const pendingInitialSubmission =
    queryClient.getQueryData<PendingInitialConversationSubmission>(
      conversationKeys.pendingSubmission(conversationId),
    ) ?? null
  const initialSubmission = shouldUsePendingConversationSeed({
    detail: cachedDetail,
    initialSubmission: pendingInitialSubmission,
  })
    ? pendingInitialSubmission
    : null

  useEffect(() => {
    if (!pendingInitialSubmission || initialSubmission) {
      return
    }

    clearPendingInitialSubmission()
  }, [clearPendingInitialSubmission, initialSubmission, pendingInitialSubmission])

  const { data, error, isLoading } = useQuery({
    enabled: initialSubmission == null,
    queryFn: () => fetchChatConversationDetail(conversationId),
    queryKey: detailQueryKey,
  })

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

  const resolvedData = data ?? cachedDetail

  if (isLoading && !resolvedData) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--sea-ink-soft)]">
        Loading conversation...
      </div>
    )
  }

  if (!resolvedData) {
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
      initialCurrentLeafMessageUuid={resolvedData.current_leaf_message_uuid}
      initialMapping={resolvedData.mapping}
      onConversationChanged={refreshConversationCaches}
      onInitialSubmissionConsumed={clearPendingInitialSubmission}
      initialSubmission={initialSubmission}
      title={resolvedData.title}
    />
  )
}
