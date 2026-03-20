import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useRef } from 'react'
import { v7 as generateTimeOrderedUuid } from 'uuid'
import { ConversationComposer } from '#/features/chat/components'
import { createChatConversation, upsertConversationListCache } from '#/features/chat/api'
import { useConversationStore } from '#/features/conversation/store/conversation-store'

export const Route = createFileRoute('/')({ component: LandingPage })

function LandingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const abortControllerRef = useRef<AbortController | null>(null)

  const { isPending, mutateAsync } = useMutation({
    mutationFn: ({ uuid, signal }: { uuid: string; signal: AbortSignal; model: string; prompt: string }) =>
      createChatConversation({ uuid, signal }),

    onSettled: () => {
      abortControllerRef.current = null
    },
  })

  const handleSubmit = async ({
    model,
    prompt,
  }: {
    model: string
    prompt: string
  }) => {
    const conversationId = generateTimeOrderedUuid()
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    // 创建会话
    const createdConversation = await mutateAsync({
      uuid: conversationId,
      signal: abortController.signal,
      model,
      prompt,
    })

    // 更新会话列表显示新会话
    upsertConversationListCache(queryClient, createdConversation)

    void useConversationStore.getState().sendMessage(conversationId, {
      model,
      prompt,
    }).catch((error) => {
      console.error('Initial message failed:', error)
    })

    navigate({
      params: { conversationId },
      to: '/chat/$conversationId',
    })
  }

  const handleStop = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }

  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-3xl">
        <div className="mb-8 space-y-3 text-center">
          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-kicker">
            Conversations
          </div>
          <h1 className="font-['Fraunces'] text-4xl text-sea-ink sm:text-5xl">
            Start a new session
          </h1>
          <p className="mx-auto max-w-2xl text-sm leading-7 text-sea-ink-soft sm:text-base">
            Use the same composer as an open conversation. Sending here creates
            the session first, then continues in its dedicated route.
          </p>
        </div>

        <ConversationComposer
          isPending={isPending}
          onStop={handleStop}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  )
}
