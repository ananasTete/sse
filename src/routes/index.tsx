import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowUp } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { v7 as generateTimeOrderedUuid } from 'uuid'
import { ConversationComposer } from '#/features/chat/components/conversation-composer'
import {
  buildConversationDetailSnapshot,
  buildConversationTitleFromPrompt,
  conversationKeys,
  createChatConversation,
  upsertConversationListCache,
} from '#/features/chat/conversation-client'
import { DEFAULT_MODEL } from '#/features/chat/constants'
import { setPendingInitialSubmission } from '#/features/chat/pending-initial-submission'

export const Route = createFileRoute('/')({ component: LandingPage })

function LandingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL)
  const createConversationMutation = useMutation({
    mutationFn: createChatConversation,
  })

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFeedback(null)

    const prompt = input.trim()

    if (!prompt) {
      setFeedback('Prompt cannot be empty.')
      return
    }

    const conversationId = generateTimeOrderedUuid()

    try {
      const createdConversation = await createConversationMutation.mutateAsync({
        uuid: conversationId,
      })
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
      setPendingInitialSubmission(conversationId, {
        model: selectedModel,
        prompt,
      })
      await navigate({
        params: {
          conversationId,
        },
        to: '/chat/$conversationId',
      })
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : 'Failed to create conversation.',
      )
    }
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
            Create a real conversation record first, then stream the opening
            prompt into its dedicated route.
          </p>
        </div>

        <ConversationComposer
          actions={
            <button
              className="inline-flex h-10 items-center justify-center border border-[var(--sea-ink)] bg-[var(--sea-ink)] px-4 text-sm font-medium text-[var(--foam)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={createConversationMutation.isPending}
              type="submit"
            >
              <ArrowUp className="mr-2 size-4" />
              Start chat
            </button>
          }
          feedback={feedback}
          onInputChange={(event) => {
            setInput(event.target.value)
          }}
          onSubmit={handleSubmit}
          placeholder="What do you want to work on?"
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          statusHint={
            createConversationMutation.isPending ? 'Creating conversation...' : null
          }
          textareaClassName="min-h-32"
          value={input}
        />
      </div>
    </div>
  )
}
