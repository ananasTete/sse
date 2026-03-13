import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { ConversationView } from '#/features/chat/components'
import {
  conversationKeys,
  fetchChatConversationDetail,
  upsertConversationListCache,
} from '#/features/chat/api'
import type {
  ChatConversationDetail,
  ChatConversationRouteState,
} from '#/features/chat/models'

export const Route = createFileRoute('/chat/$conversationId')({
  loader: ({ location }) => ({
    initialSubmission:
      (location.state as ChatConversationRouteState | undefined)
        ?.initialSubmission ?? null,
  }),
  component: ConversationPage,
})

function ConversationPage() {
  const { conversationId } = Route.useParams()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const detailQueryKey = conversationKeys.detail(conversationId)
  const { initialSubmission: initialSubmissionFromLoader } =
    Route.useLoaderData()

  const initialSubmissionRef = useRef(initialSubmissionFromLoader)
  const initialSubmission = initialSubmissionRef.current
  const shouldSkipInitialDetailFetchRef = useRef(
    initialSubmission != null &&
      queryClient.getQueryData<ChatConversationDetail>(detailQueryKey) != null,
  )

  useEffect(() => {
    if (!initialSubmission) {
      return
    }

    void navigate({
      params: { conversationId },
      replace: true,
      state: (current) => {
        const { initialSubmission: _initialSubmission, ...rest } =
          ((current as ChatConversationRouteState | undefined) ?? {})

        return rest
      },
      to: '/chat/$conversationId',
    })
  }, [conversationId, initialSubmission, navigate])

  const { data, error, isLoading } = useQuery({
    enabled: !shouldSkipInitialDetailFetchRef.current,
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

  const resolvedData =
    data ?? queryClient.getQueryData<ChatConversationDetail>(detailQueryKey)

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--sea-ink-soft)]">
        Loading conversation...
      </div>
    )
  }

  if (error || !resolvedData) {
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
      initialSubmission={initialSubmission}
      title={resolvedData.title}
    />
  )
}
