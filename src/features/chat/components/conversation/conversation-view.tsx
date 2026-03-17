import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  RotateCcw,
  X,
} from 'lucide-react'

import { useEffect, useRef, useState } from 'react'
import { MessageContent } from '../message/message-content'
import { DEFAULT_MODEL } from '../../models/constants'
import { useConversationStore } from '../../store/conversation-store'
import {
  useConversationErrorMessage,
  useConversationMessages,
  useConversationStatus,
} from '../../hooks'
import { cn } from '#/lib/utils'
import { ConversationComposer } from './conversation-composer'

export function ConversationView({
  conversationId,
}: {
  conversationId: string
}) {
  const sendMessage = useConversationStore((state) => state.sendMessage)
  const editUserMessage = useConversationStore((state) => state.editUserMessage)
  const regenerate = useConversationStore((state) => state.regenerate)
  const regenerateUserMessage = useConversationStore((state) => state.regenerateUserMessage)
  const selectBranch = useConversationStore((state) => state.selectBranch)
  const stop = useConversationStore((state) => state.stop)

  const messages = useConversationMessages(conversationId)
  const errorMessage = useConversationErrorMessage(conversationId)
  const status = useConversationStatus(conversationId)

  const [editingMessageUuid, setEditingMessageUuid] = useState<string | null>(
    null,
  )
  const [editingPrompt, setEditingPrompt] = useState('')
  const [expandedToolBlocks, setExpandedToolBlocks] = useState<
    Record<string, boolean>
  >({})
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const isBusy = status === 'streaming' || status === 'submitted'
  const lastMessageUpdatedAt =
    messages[messages.length - 1]?.updated_at ?? null

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

  const handleSubmit = async ({
    model,
    prompt,
  }: {
    model: string
    prompt: string
  }) => {
    await sendMessage(conversationId, { model, prompt })
  }

  const handleRegenerate = async (assistantMessageUuid: string) => {
    await regenerate(conversationId, assistantMessageUuid)
  }

  const handleRegenerateUserMessage = async (userMessageUuid: string) => {
    await regenerateUserMessage(conversationId, userMessageUuid)
  }

  const handleBranchSelect = (assistantMessageUuid: string) => {
    void selectBranch(conversationId, assistantMessageUuid)
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
    await editUserMessage(conversationId, message.uuid, {
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {errorMessage ? (
          <div className="border-b border-[rgba(160,74,53,0.18)] bg-[rgba(160,74,53,0.08)] px-5 py-3 text-sm text-[var(--sea-ink)]">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-[rgb(160,74,53)]" />
              <p className="leading-6">{errorMessage}</p>
            </div>
          </div>
        ) : null}

        <div
          className="flex-1 space-y-4 overflow-y-auto px-5 py-5"
          ref={transcriptRef}
        >
          {messages.length ? (
            messages.map((message) => {
              const isUser = message.role === 'user'
              const isAssistant = message.role === 'assistant'
              const isEditingUserMessage =
                isUser && editingMessageUuid === message.uuid

              const {
                branchIndex,
                branchCount,
                previousBranchUuid,
                nextBranchUuid,
              } =
                message.branchInfo ?? {
                  branchCount: 0,
                  branchIndex: -1,
                  nextBranchUuid: null,
                  previousBranchUuid: null,
                }

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
                        isStreamingMessage={message.isStreaming}
                        onToggleToolBlock={handleToggleToolBlock}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-[0.95rem] leading-7 text-[var(--sea-ink)]">
                        {message.plainText}
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
                                handleStartEdit(message.uuid, message.plainText)
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

                        {branchCount > 1 ? (
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
                              {branchIndex + 1}/{branchCount}
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

                        {branchCount > 1 ? (
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
                              {branchIndex + 1}/{branchCount}
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
          <ConversationComposer
            isPending={isBusy}
            onStop={() => {
              void stop(conversationId)
            }}
            onSubmit={handleSubmit}
          />
        </div>
      </div>
    </section>
  )
}
