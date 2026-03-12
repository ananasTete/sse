import {
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  RotateCcw,
  X,
} from 'lucide-react'

import { useEffect, useRef, useState } from 'react'
import { MessageContent } from '#/features/chat/components/message-content'
import { DEFAULT_MODEL } from '#/features/chat/constants'
import type { PendingInitialConversationSubmission } from '#/features/chat/conversation-model'
import type { ChatState } from '#/features/chat/state'
import type { ChatContent } from '#/features/chat/types'
import { useChat } from '#/features/chat/use-chat'
import { cn } from '#/lib/utils'
import { ConversationComposerPanel } from './conversation-composer-panel'

function getMessageText(text: string) {
  return text.trim() || ' '
}

function getTextContent(blocks: ChatContent[]) {
  return blocks
    .filter(
      (
        block,
      ): block is Extract<ChatContent, { type: 'text' }> =>
        block != null && block.type === 'text',
    )
    .map((block) => block.text)
    .join('')
}

export function ConversationView({
  conversationId,
  initialCurrentLeafMessageUuid,
  initialMapping,
  initialSubmission,
  onConversationChanged,
  title,
}: {
  conversationId: string
  initialCurrentLeafMessageUuid: string | null
  initialMapping: ChatState['mapping']
  initialSubmission?: PendingInitialConversationSubmission | null
  onConversationChanged?: () => void | Promise<void>
  title: string
}) {
  const {
    editUserMessage,
    getBranchState,
    messages,
    regenerate,
    regenerateUserMessage,
    selectBranch,
    sendMessage,
    status,
    stop,
  } = useChat({
    conversationId,
    initialCurrentLeafMessageUuid,
    initialMapping,
    onConversationChanged,
  })
  const [editingMessageUuid, setEditingMessageUuid] = useState<string | null>(
    null,
  )
  const [editingPrompt, setEditingPrompt] = useState('')
  const [expandedToolBlocks, setExpandedToolBlocks] = useState<
    Record<string, boolean>
  >({})
  const initialSubmissionRef = useRef(initialSubmission ?? null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const isBusy = status === 'streaming' || status === 'submitted'
  const lastMessageUpdatedAt =
    messages[messages.length - 1]?.updated_at ?? null
  const statusLabel =
    status === 'submitted'
      ? 'waiting'
      : status === 'streaming'
        ? 'streaming'
        : status === 'error'
          ? 'error'
          : 'ready'

  useEffect(() => {
    if (!lastMessageUpdatedAt && status === 'ready') {
      return
    }

    const container = transcriptRef.current

    if (!container) {
      return
    }

    container.scrollTo({
      behavior: 'smooth',
      top: container.scrollHeight,
    })
  }, [lastMessageUpdatedAt, status])

  useEffect(() => {
    if (!editingMessageUuid) {
      return
    }

    const hasEditingMessage = messages.some(
      (message) => message.uuid === editingMessageUuid,
    )

    if (!hasEditingMessage) {
      setEditingMessageUuid(null)
      setEditingPrompt('')
    }
  }, [editingMessageUuid, messages])

  useEffect(() => {
    const submission = initialSubmissionRef.current

    if (!submission || messages.length > 0 || status !== 'ready') {
      return
    }

    initialSubmissionRef.current = null

    void sendMessage({
      model: submission.model,
      prompt: submission.prompt,
    })
  }, [messages.length, sendMessage, status])

  const handleSubmit = async ({
    model,
    prompt,
  }: {
    model: string
    prompt: string
  }) => {
    await sendMessage({ model, prompt })
  }

  const handleRegenerate = async (assistantMessageUuid: string) => {
    await regenerate(assistantMessageUuid)
  }

  const handleRegenerateUserMessage = async (userMessageUuid: string) => {
    await regenerateUserMessage(userMessageUuid)
  }

  const handleBranchSelect = (assistantMessageUuid: string) => {
    selectBranch(assistantMessageUuid)
  }

  const handleStartEdit = (messageUuid: string, prompt: string) => {
    setEditingMessageUuid(messageUuid)
    setEditingPrompt(prompt)
  }

  const handleCancelEdit = () => {
    setEditingMessageUuid(null)
    setEditingPrompt('')
  }

  const handleConfirmEdit = async (message: (typeof messages)[number]) => {
    await editUserMessage(message.uuid, {
      model: message.model ?? DEFAULT_MODEL,
      prompt: editingPrompt,
    })
    setEditingMessageUuid(null)
    setEditingPrompt('')
  }

  const handleToggleToolBlock = (toolUseId: string) => {
    setExpandedToolBlocks((current) => ({
      ...current,
      [toolUseId]: !(current[toolUseId] ?? false),
    }))
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--header-bg)] px-5 py-4 text-sm">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-[var(--sea-ink)]">
            {title}
          </div>
          <div className="text-[var(--sea-ink-soft)]">
            {messages.length} messages
          </div>
        </div>
        <span className="font-medium text-[var(--sea-ink-soft)]">{statusLabel}</span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className="flex-1 space-y-4 overflow-y-auto px-5 py-5"
          ref={transcriptRef}
        >
          {messages.length ? (
            messages.map((message, index) => {
              const rawText = getTextContent(message.content)
              const text = getMessageText(rawText)
              const isUser = message.role === 'user'
              const isAssistant = message.role === 'assistant'
              const isEditingUserMessage =
                isUser && editingMessageUuid === message.uuid
              const branchChildUuids =
                isAssistant || isUser
                  ? getBranchState(message.parent_message_uuid)
                  : []
              const branchIndex = branchChildUuids.indexOf(message.uuid)
              const previousBranchUuid =
                branchIndex > 0 ? branchChildUuids[branchIndex - 1] : null
              const nextBranchUuid =
                branchIndex >= 0 && branchIndex < branchChildUuids.length - 1
                  ? branchChildUuids[branchIndex + 1]
                  : null
              const isStreamingMessage =
                isAssistant &&
                isBusy &&
                index === messages.length - 1 &&
                message.stop_reason === null

              return (
                <article
                  className={cn(
                    'flex w-full',
                    isAssistant ? 'justify-start' : 'justify-end',
                  )}
                  key={message.uuid}
                >
                  <div
                    className={cn(
                      'border px-4 py-3',
                      isEditingUserMessage
                        ? 'w-full'
                        : 'max-w-[min(42rem,92%)]',
                      isAssistant
                        ? 'border-[var(--line)] bg-[var(--surface-strong)]'
                        : 'border-[var(--line)] bg-[rgba(47,106,74,0.08)]',
                    )}
                  >
                    {isEditingUserMessage ? (
                      <div>
                        <textarea
                          className="min-h-28 w-full resize-y border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[0.95rem] leading-7 text-[var(--sea-ink)] outline-none"
                          onChange={(event) => {
                            setEditingPrompt(event.target.value)
                          }}
                          value={editingPrompt}
                        />
                      </div>
                    ) : isAssistant ? (
                      <MessageContent
                        blocks={message.content}
                        expandedToolBlocks={expandedToolBlocks}
                        isStreamingMessage={isStreamingMessage}
                        onToggleToolBlock={handleToggleToolBlock}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-[0.95rem] leading-7 text-[var(--sea-ink)]">
                        {text}
                      </p>
                    )}

                    {isUser ? (
                      <div className="mt-3 flex items-center gap-3 border-t border-[var(--line)] pt-3 text-[0.72rem] text-[var(--sea-ink-soft)]">
                        {isEditingUserMessage ? (
                          <>
                            <button
                              className="inline-flex items-center gap-1 transition hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-40"
                              disabled={isBusy}
                              onClick={handleCancelEdit}
                              type="button"
                            >
                              <X className="size-3.5" />
                              Cancel
                            </button>

                            <button
                              className="inline-flex items-center gap-1 transition hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-40"
                              disabled={isBusy || !editingPrompt.trim()}
                              onClick={() => {
                                void handleConfirmEdit(message)
                              }}
                              type="button"
                            >
                              <Check className="size-3.5" />
                              Confirm
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="inline-flex items-center gap-1 transition hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-40"
                              disabled={isBusy}
                              onClick={() => {
                                handleStartEdit(message.uuid, rawText)
                              }}
                              type="button"
                            >
                              <Pencil className="size-3.5" />
                              Edit
                            </button>

                            <button
                              className="inline-flex items-center gap-1 transition hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-40"
                              disabled={isBusy}
                              onClick={() => {
                                void handleRegenerateUserMessage(message.uuid)
                              }}
                              type="button"
                            >
                              <RotateCcw className="size-3.5" />
                              Regenerate
                            </button>
                          </>
                        )}

                        {branchChildUuids.length > 1 ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              className="inline-flex size-5 items-center justify-center border border-transparent transition hover:border-[var(--line)] hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-35"
                              disabled={
                                !previousBranchUuid ||
                                isBusy ||
                                isEditingUserMessage
                              }
                              onClick={() => {
                                if (!previousBranchUuid) {
                                  return
                                }

                                handleBranchSelect(previousBranchUuid)
                              }}
                              type="button"
                            >
                              <ChevronLeft className="size-3.5" />
                            </button>

                            <span>
                              {branchIndex + 1}/{branchChildUuids.length}
                            </span>

                            <button
                              className="inline-flex size-5 items-center justify-center border border-transparent transition hover:border-[var(--line)] hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-35"
                              disabled={
                                !nextBranchUuid ||
                                isBusy ||
                                isEditingUserMessage
                              }
                              onClick={() => {
                                if (!nextBranchUuid) {
                                  return
                                }

                                handleBranchSelect(nextBranchUuid)
                              }}
                              type="button"
                            >
                              <ChevronRight className="size-3.5" />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {isAssistant ? (
                      <div className="mt-3 flex items-center gap-3 border-t border-[var(--line)] pt-3 text-[0.72rem] text-[var(--sea-ink-soft)]">
                        <button
                          className="inline-flex items-center gap-1 transition hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={isBusy}
                          onClick={() => {
                            void handleRegenerate(message.uuid)
                          }}
                          type="button"
                        >
                          <RotateCcw className="size-3.5" />
                          Regenerate
                        </button>

                        {branchChildUuids.length > 1 ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              className="inline-flex size-5 items-center justify-center border border-transparent transition hover:border-[var(--line)] hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-35"
                              disabled={!previousBranchUuid || isBusy}
                              onClick={() => {
                                if (!previousBranchUuid) {
                                  return
                                }

                                handleBranchSelect(previousBranchUuid)
                              }}
                              type="button"
                            >
                              <ChevronLeft className="size-3.5" />
                            </button>

                            <span>
                              {branchIndex + 1}/{branchChildUuids.length}
                            </span>

                            <button
                              className="inline-flex size-5 items-center justify-center border border-transparent transition hover:border-[var(--line)] hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-35"
                              disabled={!nextBranchUuid || isBusy}
                              onClick={() => {
                                if (!nextBranchUuid) {
                                  return
                                }

                                handleBranchSelect(nextBranchUuid)
                              }}
                              type="button"
                            >
                              <ChevronRight className="size-3.5" />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              )
            })
          ) : (
            <div className="flex min-h-full items-center justify-center py-12 text-sm text-[var(--sea-ink-soft)]">
              No messages yet.
            </div>
          )}
        </div>

        <div className="border-t border-[var(--line)] bg-[var(--surface-strong)] p-4">
          <ConversationComposerPanel
            isPending={isBusy}
            onStop={stop}
            onSubmit={handleSubmit}
          />
        </div>
      </div>
    </section>
  )
}
