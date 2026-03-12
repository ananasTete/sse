import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useRef } from 'react'
import { v7 as generateTimeOrderedUuid } from 'uuid'
import { ConversationComposerPanel } from '#/features/chat/components/conversation-composer-panel'
import {
  buildConversationDetailSnapshot,
  buildConversationTitleFromPrompt,
  conversationKeys,
  createChatConversation,
  upsertConversationListCache,
} from '#/features/chat/conversation-client'
import { setPendingInitialSubmission } from '#/features/chat/pending-initial-submission'

export const Route = createFileRoute('/')({ component: LandingPage })

function LandingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const abortControllerRef = useRef<AbortController | null>(null)

  const { isPending, mutate } = useMutation({
    mutationFn: ({
      uuid,
      signal,
    }: {
      uuid: string
      signal: AbortSignal
      model: string
      prompt: string
    }) => createChatConversation({ uuid, signal }),

    onSuccess: (createdConversation, { uuid: conversationId, model, prompt }) => {
      const cachedTitle = buildConversationTitleFromPrompt(prompt)

      queryClient.setQueryData(
        conversationKeys.detail(conversationId),
        buildConversationDetailSnapshot({
          summary: createdConversation,
          title: cachedTitle,
        }),
      )
      upsertConversationListCache(queryClient, {
        ...createdConversation,
        title: cachedTitle,
      })
      setPendingInitialSubmission(conversationId, { model, prompt })
      navigate({
        params: { conversationId },
        to: '/chat/$conversationId',
      })
    },

    onSettled: () => {
      abortControllerRef.current = null
    },
  })

  const handleSubmit = ({
    model,
    prompt,
  }: {
    model: string
    prompt: string
  }) => {
    const conversationId = generateTimeOrderedUuid()
    const abortController = new AbortController()

    abortControllerRef.current = abortController
    mutate({ uuid: conversationId, signal: abortController.signal, model, prompt })
  }

  const handleStop = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }

  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-3xl">
        <div className="mb-8 space-y-3 text-center">
          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-[var(--kicker)]">
            Conversations
          </div>
          <h1 className="font-['Fraunces'] text-4xl text-[var(--sea-ink)] sm:text-5xl">
            Start a new session
          </h1>
          <p className="mx-auto max-w-2xl text-sm leading-7 text-[var(--sea-ink-soft)] sm:text-base">
            Use the same composer as an open conversation. Sending here creates
            the session first, then continues in its dedicated route.
          </p>
        </div>

        <ConversationComposerPanel
          isPending={isPending}
          onStop={handleStop}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  )
}
