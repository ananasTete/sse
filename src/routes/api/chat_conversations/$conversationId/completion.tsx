import { createFileRoute } from '@tanstack/react-router'
import {
  mutateConversation,
  updateConversationSummaryFields,
} from '#/features/chat/conversation-store'
import { createUserMessage } from '#/features/chat/message-builders'
import { formatSseEvent } from '#/features/chat/sse'
import { toChatTimestamp } from '#/features/chat/time'
import type { ChatConversationDetail } from '#/features/chat/conversation-model'
import type {
  ChatCitation,
  ChatCompletionRequest,
  ChatMessage,
  ChatToolUseContent,
  NewChatMessage,
} from '#/features/chat/types'

export const Route = createFileRoute(
  '/api/chat_conversations/$conversationId/completion',
)({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const body = (await request.json()) as ChatCompletionRequest
        const encoder = new TextEncoder()
        const assistantParentUuid =
          body.trigger === 'regenerate'
            ? body.parent_message_uuid
            : body.turn_message_uuids.user_message_uuid
        const query = buildSearchQuery(body)
        const searchResults = buildSearchResults(query)
        const replySegments = buildMockReplySegments(body, query, searchResults)
        const assistantMessageUuid =
          body.turn_message_uuids.assistant_message_uuid
        const toolUseId = `toolu_${assistantMessageUuid.replaceAll('-', '')}`
        const userMessage =
          body.trigger === 'submit'
            ? createUserMessage({
                files: body.files,
                model: body.model,
                parentMessageUuid: body.parent_message_uuid,
                prompt: body.prompt.trim(),
                uuid: body.turn_message_uuids.user_message_uuid,
              })
            : null
        const assistantMessage = createPendingAssistantMessage({
          model: body.model,
          parentUuid: assistantParentUuid,
          uuid: assistantMessageUuid,
        })

        try {
          mutateConversation(params.conversationId, (conversation) => {
            if (userMessage) {
              appendMessageToConversation(conversation, userMessage)
            }

            appendMessageToConversation(conversation, assistantMessage)
            updateConversationSummaryFields(conversation, {
              currentLeafMessageUuid: assistantMessage.uuid,
              prompt:
                userMessage?.content[0]?.type === 'text'
                  ? userMessage.content[0].text
                  : body.prompt,
              updatedAt: assistantMessage.updated_at,
            })
          })
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Conversation not found.',
            },
            { status: 404 },
          )
        }

        return new Response(
          new ReadableStream({
            async start(controller) {
              let closed = false
              let textLength = 0
              let toolUseInputJsonBuffer = ''
              let toolResultDisplayContentJsonBuffer = ''
              const openCitations = new Map<
                string,
                {
                  citation: Omit<ChatCitation, 'end_index' | 'start_index'>
                  startIndex: number
                }
              >()

              const close = () => {
                if (closed) {
                  return
                }

                closed = true
                controller.close()
              }

              const enqueue = (chunk: string) => {
                if (closed || request.signal.aborted) {
                  return false
                }

                controller.enqueue(encoder.encode(chunk))
                return true
              }

              const abortListener = () => {
                persistAbort(params.conversationId, assistantMessageUuid)
                close()
              }

              request.signal.addEventListener('abort', abortListener)

              try {
                if (
                  !enqueue(
                    formatSseEvent('message_start', {
                      message: {
                        content: [],
                        id: `chatcompl_${assistantMessageUuid.replaceAll('-', '')}`,
                        model: body.model,
                        parent_uuid: assistantParentUuid,
                        role: 'assistant',
                        stop_reason: null,
                        stop_sequence: null,
                        type: 'message',
                        uuid: assistantMessageUuid,
                      },
                      type: 'message_start',
                    }),
                  )
                ) {
                  return
                }

                await sleep(280)

                const toolUseStartTimestamp = toChatTimestamp()

                if (
                  !enqueue(
                    formatSseEvent('content_block_start', {
                      content_block: {
                        display_content: null,
                        flags: null,
                        icon_name: 'globe',
                        id: toolUseId,
                        input: {},
                        message: 'Searching the web',
                        name: 'web_search',
                        start_timestamp: toolUseStartTimestamp,
                        stop_timestamp: null,
                        type: 'tool_use',
                      },
                      index: 0,
                      type: 'content_block_start',
                    }),
                  )
                ) {
                  return
                }

                mutateConversation(params.conversationId, (conversation) => {
                  startToolUseBlock(
                    conversation,
                    assistantMessageUuid,
                    toolUseId,
                    toolUseStartTimestamp,
                  )
                })

                for (const chunk of chunkJson(JSON.stringify({ query }))) {
                  await sleep(180)

                  if (
                    !enqueue(
                      formatSseEvent('content_block_delta', {
                        delta: {
                          partial_json: chunk,
                          type: 'input_json_delta',
                        },
                        index: 0,
                        type: 'content_block_delta',
                      }),
                    )
                  ) {
                    return
                  }

                  toolUseInputJsonBuffer += chunk
                  updateToolUseInput(
                    params.conversationId,
                    assistantMessageUuid,
                    toolUseId,
                    toolUseInputJsonBuffer,
                  )
                }

                await sleep(900)

                const toolPreviewMessage = `Fetching: ${searchResults[0]?.url ?? query}`

                if (
                  !enqueue(
                    formatSseEvent('content_block_delta', {
                      delta: {
                        display_content: {
                          preview_url: searchResults[0]?.url ?? null,
                        },
                        message: toolPreviewMessage,
                        type: 'tool_use_block_update_delta',
                      },
                      index: 0,
                      type: 'content_block_delta',
                    }),
                  )
                ) {
                  return
                }

                mutateConversation(params.conversationId, (conversation) => {
                  updateToolUseMessage(
                    conversation,
                    assistantMessageUuid,
                    toolUseId,
                    toolPreviewMessage,
                    {
                      preview_url: searchResults[0]?.url ?? null,
                    },
                  )
                })

                await sleep(900)

                const toolUseStopTimestamp = toChatTimestamp()

                if (
                  !enqueue(
                    formatSseEvent('content_block_stop', {
                      index: 0,
                      stop_timestamp: toolUseStopTimestamp,
                      type: 'content_block_stop',
                    }),
                  )
                ) {
                  return
                }

                mutateConversation(params.conversationId, (conversation) => {
                  stopContentBlock(
                    conversation,
                    assistantMessageUuid,
                    0,
                    toolUseStopTimestamp,
                  )
                })

                await sleep(700)

                const toolResultStartTimestamp = toChatTimestamp()
                const toolResultMessage = `Found ${searchResults.length} sources`

                if (
                  !enqueue(
                    formatSseEvent('content_block_start', {
                      content_block: {
                        display_content: null,
                        flags: null,
                        icon_name: 'globe',
                        is_error: false,
                        message: toolResultMessage,
                        name: 'web_search',
                        start_timestamp: toolResultStartTimestamp,
                        stop_timestamp: null,
                        tool_use_id: toolUseId,
                        type: 'tool_result',
                      },
                      index: 1,
                      type: 'content_block_start',
                    }),
                  )
                ) {
                  return
                }

                mutateConversation(params.conversationId, (conversation) => {
                  startToolResultBlock(
                    conversation,
                    assistantMessageUuid,
                    toolUseId,
                    toolResultMessage,
                    toolResultStartTimestamp,
                  )
                })

                for (const chunk of chunkJson(JSON.stringify(searchResults))) {
                  await sleep(160)

                  if (
                    !enqueue(
                      formatSseEvent('content_block_delta', {
                        delta: {
                          partial_json: chunk,
                          type: 'input_json_delta',
                        },
                        index: 1,
                        type: 'content_block_delta',
                      }),
                    )
                  ) {
                    return
                  }

                  toolResultDisplayContentJsonBuffer += chunk
                  updateToolResultDisplayContent(
                    params.conversationId,
                    assistantMessageUuid,
                    toolUseId,
                    toolResultDisplayContentJsonBuffer,
                  )
                }

                await sleep(1000)

                const toolResultStopTimestamp = toChatTimestamp()

                if (
                  !enqueue(
                    formatSseEvent('content_block_stop', {
                      index: 1,
                      stop_timestamp: toolResultStopTimestamp,
                      type: 'content_block_stop',
                    }),
                  )
                ) {
                  return
                }

                mutateConversation(params.conversationId, (conversation) => {
                  stopToolResultBlock(
                    conversation,
                    assistantMessageUuid,
                    toolUseId,
                    toolResultStopTimestamp,
                  )
                })

                await sleep(650)

                const textBlockStartTimestamp = toChatTimestamp()

                if (
                  !enqueue(
                    formatSseEvent('content_block_start', {
                      content_block: {
                        citations: [],
                        flags: null,
                        start_timestamp: textBlockStartTimestamp,
                        stop_timestamp: null,
                        text: '',
                        type: 'text',
                      },
                      index: 2,
                      type: 'content_block_start',
                    }),
                  )
                ) {
                  return
                }

                mutateConversation(params.conversationId, (conversation) => {
                  startTextBlock(
                    conversation,
                    assistantMessageUuid,
                    textBlockStartTimestamp,
                  )
                })

                for (const segment of replySegments) {
                  if (segment.type === 'citation_start') {
                    await sleep(70)

                    if (
                      !enqueue(
                        formatSseEvent('content_block_delta', {
                          delta: {
                            citation: segment.citation,
                            type: 'citation_start_delta',
                          },
                          index: 2,
                          type: 'content_block_delta',
                        }),
                      )
                    ) {
                      return
                    }

                    openCitations.set(segment.citation.uuid, {
                      citation: segment.citation,
                      startIndex: textLength,
                    })
                    continue
                  }

                  if (segment.type === 'citation_end') {
                    await sleep(70)

                    if (
                      !enqueue(
                        formatSseEvent('content_block_delta', {
                          delta: {
                            citation_uuid: segment.citationUuid,
                            type: 'citation_end_delta',
                          },
                          index: 2,
                          type: 'content_block_delta',
                        }),
                      )
                    ) {
                      return
                    }

                    const openCitation = openCitations.get(segment.citationUuid)

                    if (openCitation) {
                      openCitations.delete(segment.citationUuid)
                      mutateConversation(params.conversationId, (conversation) => {
                        addCitationToTextBlock(conversation, assistantMessageUuid, {
                          ...openCitation.citation,
                          end_index: textLength,
                          start_index: openCitation.startIndex,
                        })
                      })
                    }

                    continue
                  }

                  for (const chunk of chunkText(segment.text)) {
                    await sleep(70)

                    if (
                      !enqueue(
                        formatSseEvent('content_block_delta', {
                          delta: {
                            text: chunk,
                            type: 'text_delta',
                          },
                          index: 2,
                          type: 'content_block_delta',
                        }),
                      )
                    ) {
                      return
                    }

                    textLength += chunk.length
                    mutateConversation(params.conversationId, (conversation) => {
                      appendTextDelta(conversation, assistantMessageUuid, chunk)
                    })
                  }
                }

                await sleep(180)

                const textBlockStopTimestamp = toChatTimestamp()

                if (
                  !enqueue(
                    formatSseEvent('content_block_stop', {
                      index: 2,
                      stop_timestamp: textBlockStopTimestamp,
                      type: 'content_block_stop',
                    }),
                  )
                ) {
                  return
                }

                mutateConversation(params.conversationId, (conversation) => {
                  stopContentBlock(
                    conversation,
                    assistantMessageUuid,
                    2,
                    textBlockStopTimestamp,
                  )
                })

                await sleep(120)

                if (
                  !enqueue(
                    formatSseEvent('message_delta', {
                      delta: {
                        stop_reason: 'end_turn',
                        stop_sequence: null,
                      },
                      type: 'message_delta',
                    }),
                  )
                ) {
                  return
                }

                mutateConversation(params.conversationId, (conversation) => {
                  finishAssistantMessage(
                    conversation,
                    assistantMessageUuid,
                    textBlockStopTimestamp,
                  )
                })

                await sleep(120)

                if (
                  !enqueue(
                    formatSseEvent('message_limit', {
                      message_limit: buildMessageLimit(),
                      type: 'message_limit',
                    }),
                  )
                ) {
                  return
                }

                mutateConversation(params.conversationId, (conversation) => {
                  attachMessageLimit(conversation, assistantMessageUuid)
                })

                await sleep(20)

                enqueue(
                  formatSseEvent('message_stop', {
                    type: 'message_stop',
                  }),
                )
              } catch (error) {
                if (!closed) {
                  closed = true
                  controller.error(error)
                }
              } finally {
                request.signal.removeEventListener('abort', abortListener)
                close()
              }
            },
          }),
          {
            headers: {
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
              'Content-Type': 'text/event-stream; charset=utf-8',
              'X-Accel-Buffering': 'no',
            },
          },
        )
      },
    },
  },
})

function appendMessageToConversation(
  conversation: ChatConversationDetail,
  message: NewChatMessage,
) {
  const nextIndex = Object.values(conversation.mapping).reduce(
    (maxIndex, node) => Math.max(maxIndex, node.message?.index ?? -1),
    -1,
  ) + 1
  const indexedMessage: ChatMessage = {
    ...message,
    index: nextIndex,
  }

  conversation.mapping[indexedMessage.uuid] = {
    child_uuids: [],
    message: indexedMessage,
    parent_uuid: indexedMessage.parent_message_uuid,
    uuid: indexedMessage.uuid,
  }

  const parentNode = conversation.mapping[indexedMessage.parent_message_uuid]

  if (parentNode && !parentNode.child_uuids.includes(indexedMessage.uuid)) {
    parentNode.child_uuids.push(indexedMessage.uuid)
  }
}

function createPendingAssistantMessage({
  model,
  parentUuid,
  uuid,
}: {
  model: string
  parentUuid: string
  uuid: string
}) {
  const timestamp = toChatTimestamp()

  return {
    content: [],
    created_at: timestamp,
    files: [],
    metadata: {},
    model,
    parent_message_uuid: parentUuid,
    role: 'assistant',
    stop_reason: null,
    updated_at: timestamp,
    uuid,
  } satisfies NewChatMessage
}

function getMessage(
  conversation: ChatConversationDetail,
  messageUuid: string,
) {
  return conversation.mapping[messageUuid]?.message ?? null
}

function getToolUseBlock(
  conversation: ChatConversationDetail,
  messageUuid: string,
  toolUseId: string,
) {
  const message = getMessage(conversation, messageUuid)

  return (
    message?.content.find(
      (block): block is ChatToolUseContent =>
        block.type === 'tool_use' && block.id === toolUseId,
    ) ?? null
  )
}

function startToolUseBlock(
  conversation: ChatConversationDetail,
  messageUuid: string,
  toolUseId: string,
  startTimestamp: string,
) {
  const message = getMessage(conversation, messageUuid)

  if (!message) {
    return
  }

  message.content[0] = {
    display_content: null,
    icon_name: 'globe',
    id: toolUseId,
    input: {},
    message: 'Searching the web',
    name: 'web_search',
    start_timestamp: startTimestamp,
    stop_timestamp: null,
    tool_result: null,
    type: 'tool_use',
  }
  message.updated_at = startTimestamp
  updateConversationSummaryFields(conversation, {
    currentLeafMessageUuid: messageUuid,
    updatedAt: startTimestamp,
  })
}

function updateToolUseInput(
  conversationId: string,
  messageUuid: string,
  toolUseId: string,
  inputBuffer: string,
) {
  let parsedInput: Record<string, unknown> | null | undefined

  try {
    parsedInput = JSON.parse(inputBuffer) as Record<string, unknown> | null
  } catch {
    return
  }

  mutateConversation(conversationId, (conversation) => {
    const toolUseBlock = getToolUseBlock(conversation, messageUuid, toolUseId)

    if (!toolUseBlock) {
      return
    }

    const timestamp = toChatTimestamp()

    toolUseBlock.input = parsedInput ?? null
    conversation.mapping[messageUuid]!.message!.updated_at = timestamp
    updateConversationSummaryFields(conversation, {
      currentLeafMessageUuid: messageUuid,
      updatedAt: timestamp,
    })
  })
}

function updateToolUseMessage(
  conversation: ChatConversationDetail,
  messageUuid: string,
  toolUseId: string,
  messageText: string,
  displayContent: unknown,
) {
  const toolUseBlock = getToolUseBlock(conversation, messageUuid, toolUseId)

  if (!toolUseBlock) {
    return
  }

  const timestamp = toChatTimestamp()

  toolUseBlock.message = messageText
  toolUseBlock.display_content = displayContent
  conversation.mapping[messageUuid]!.message!.updated_at = timestamp
  updateConversationSummaryFields(conversation, {
    currentLeafMessageUuid: messageUuid,
    updatedAt: timestamp,
  })
}

function startToolResultBlock(
  conversation: ChatConversationDetail,
  messageUuid: string,
  toolUseId: string,
  messageText: string,
  startTimestamp: string,
) {
  const toolUseBlock = getToolUseBlock(conversation, messageUuid, toolUseId)

  if (!toolUseBlock) {
    return
  }

  toolUseBlock.tool_result = {
    display_content: null,
    icon_name: 'globe',
    is_error: false,
    message: messageText,
    name: 'web_search',
    start_timestamp: startTimestamp,
    stop_timestamp: null,
    tool_use_id: toolUseId,
    type: 'tool_result',
  }
  toolUseBlock.stop_timestamp = null
  conversation.mapping[messageUuid]!.message!.updated_at = startTimestamp
  updateConversationSummaryFields(conversation, {
    currentLeafMessageUuid: messageUuid,
    updatedAt: startTimestamp,
  })
}

function updateToolResultDisplayContent(
  conversationId: string,
  messageUuid: string,
  toolUseId: string,
  displayContentBuffer: string,
) {
  let parsedDisplayContent: unknown

  try {
    parsedDisplayContent = JSON.parse(displayContentBuffer)
  } catch {
    return
  }

  mutateConversation(conversationId, (conversation) => {
    const toolUseBlock = getToolUseBlock(conversation, messageUuid, toolUseId)
    const toolResult = toolUseBlock?.tool_result

    if (!toolUseBlock || !toolResult) {
      return
    }

    const timestamp = toChatTimestamp()

    toolResult.display_content = parsedDisplayContent
    conversation.mapping[messageUuid]!.message!.updated_at = timestamp
    updateConversationSummaryFields(conversation, {
      currentLeafMessageUuid: messageUuid,
      updatedAt: timestamp,
    })
  })
}

function startTextBlock(
  conversation: ChatConversationDetail,
  messageUuid: string,
  startTimestamp: string,
) {
  const message = getMessage(conversation, messageUuid)

  if (!message) {
    return
  }

  message.content.push({
    citations: [],
    start_timestamp: startTimestamp,
    stop_timestamp: null,
    text: '',
    type: 'text',
  })
  message.updated_at = startTimestamp
  updateConversationSummaryFields(conversation, {
    currentLeafMessageUuid: messageUuid,
    updatedAt: startTimestamp,
  })
}

function appendTextDelta(
  conversation: ChatConversationDetail,
  messageUuid: string,
  chunk: string,
) {
  const message = getMessage(conversation, messageUuid)
  const textBlock = message?.content.find(
    (block): block is Extract<ChatMessage['content'][number], { type: 'text' }> =>
      block != null && block.type === 'text',
  )

  if (!message || !textBlock || textBlock.type !== 'text') {
    return
  }

  const timestamp = toChatTimestamp()

  textBlock.text += chunk
  message.updated_at = timestamp
  updateConversationSummaryFields(conversation, {
    currentLeafMessageUuid: messageUuid,
    updatedAt: timestamp,
  })
}

function addCitationToTextBlock(
  conversation: ChatConversationDetail,
  messageUuid: string,
  citation: ChatCitation,
) {
  const message = getMessage(conversation, messageUuid)
  const textBlock = message?.content.find(
    (block): block is Extract<ChatMessage['content'][number], { type: 'text' }> =>
      block != null && block.type === 'text',
  )

  if (!message || !textBlock || textBlock.type !== 'text') {
    return
  }

  const timestamp = toChatTimestamp()

  textBlock.citations.push(citation)
  message.updated_at = timestamp
  updateConversationSummaryFields(conversation, {
    currentLeafMessageUuid: messageUuid,
    updatedAt: timestamp,
  })
}

function stopContentBlock(
  conversation: ChatConversationDetail,
  messageUuid: string,
  index: number,
  stopTimestamp: string,
) {
  const message = getMessage(conversation, messageUuid)
  const block =
    message?.content[index] ??
    (index === 2
      ? message?.content.find(
          (entry): entry is ChatMessage['content'][number] =>
            entry != null && entry.type === 'text',
        )
      : null)

  if (!message || !block) {
    return
  }

  block.stop_timestamp = stopTimestamp
  message.updated_at = stopTimestamp
  updateConversationSummaryFields(conversation, {
    currentLeafMessageUuid: messageUuid,
    updatedAt: stopTimestamp,
  })
}

function stopToolResultBlock(
  conversation: ChatConversationDetail,
  messageUuid: string,
  toolUseId: string,
  stopTimestamp: string,
) {
  const toolUseBlock = getToolUseBlock(conversation, messageUuid, toolUseId)
  const toolResult = toolUseBlock?.tool_result

  if (!toolUseBlock || !toolResult) {
    return
  }

  toolResult.stop_timestamp = stopTimestamp
  toolUseBlock.stop_timestamp = stopTimestamp
  conversation.mapping[messageUuid]!.message!.updated_at = stopTimestamp
  updateConversationSummaryFields(conversation, {
    currentLeafMessageUuid: messageUuid,
    updatedAt: stopTimestamp,
  })
}

function finishAssistantMessage(
  conversation: ChatConversationDetail,
  messageUuid: string,
  stopTimestamp: string,
) {
  const message = getMessage(conversation, messageUuid)

  if (!message) {
    return
  }

  message.stop_reason = 'end_turn'
  message.updated_at = stopTimestamp
  updateConversationSummaryFields(conversation, {
    currentLeafMessageUuid: messageUuid,
    updatedAt: stopTimestamp,
  })
}

function attachMessageLimit(
  conversation: ChatConversationDetail,
  messageUuid: string,
) {
  const message = getMessage(conversation, messageUuid)

  if (!message) {
    return
  }

  const timestamp = toChatTimestamp()

  message.metadata = {
    ...message.metadata,
    message_limit: buildMessageLimit(),
  }
  message.updated_at = timestamp
  updateConversationSummaryFields(conversation, {
    currentLeafMessageUuid: messageUuid,
    updatedAt: timestamp,
  })
}

function persistAbort(conversationId: string, messageUuid: string) {
  mutateConversation(conversationId, (conversation) => {
    const message = getMessage(conversation, messageUuid)

    if (!message) {
      return
    }

    const timestamp = toChatTimestamp()

    for (const block of message.content) {
      block.stop_timestamp ??= timestamp

      if (block.type === 'tool_use' && block.tool_result) {
        block.tool_result.stop_timestamp ??= timestamp
      }
    }

    message.stop_reason = 'user_canceled'
    message.updated_at = timestamp
    updateConversationSummaryFields(conversation, {
      currentLeafMessageUuid: messageUuid,
      updatedAt: timestamp,
    })
  })
}

function buildMessageLimit() {
  return {
    overageDisabledReason: 'overage_not_provisioned',
    overageInUse: false,
    perModelLimit: null,
    remaining: null,
    representativeClaim: 'five_hour',
    resetsAt: null,
    type: 'within_limit',
    windows: {
      '5h': {
        resets_at: 1773039600,
        status: 'within_limit',
        utilization: 0.01,
      },
    },
  }
}

function chunkText(text: string) {
  if (text.length === 0) {
    return ['']
  }

  const tokens: string[] = []

  for (let index = 0; index < text.length; index += 8) {
    tokens.push(text.slice(index, index + 8))
  }

  return tokens
}

function chunkJson(text: string) {
  const tokens = text.match(/.{1,48}/g)

  return tokens?.length ? tokens : [text]
}

function buildSearchQuery(body: ChatCompletionRequest) {
  const prompt = body.prompt.trim()

  if (prompt) {
    return prompt
  }

  return body.trigger === 'regenerate'
    ? `Follow-up for ${body.parent_message_uuid}`
    : 'OpenAI Codex pricing 2026'
}

function buildSearchResults(query: string) {
  return [
    {
      is_missing: false,
      metadata: {
        favicon_url: 'https://www.google.com/s2/favicons?sz=64&domain=openai.com',
        site_domain: 'openai.com',
        site_name: 'OpenAI',
        type: 'webpage_metadata',
      },
      title: 'Codex Pricing',
      type: 'knowledge',
      url: 'https://developers.openai.com/codex/pricing/',
    },
    {
      is_missing: false,
      metadata: {
        favicon_url: 'https://www.google.com/s2/favicons?sz=64&domain=openai.com',
        site_domain: 'openai.com',
        site_name: 'OpenAI',
        type: 'webpage_metadata',
      },
      title: `Pricing results for ${query}`,
      type: 'knowledge',
      url: 'https://developers.openai.com/api/docs/pricing/',
    },
    {
      is_missing: false,
      metadata: {
        favicon_url: 'https://www.google.com/s2/favicons?sz=64&domain=apidog.com',
        site_domain: 'apidog.com',
        site_name: 'Apidog',
        type: 'webpage_metadata',
      },
      title: 'How Affordable Is GPT-5 Codex Pricing for Developers in 2026',
      type: 'knowledge',
      url: 'https://apidog.com/blog/codex-pricing/',
    },
  ]
}

type SearchResult = ReturnType<typeof buildSearchResults>[number]

type MockReplySegment =
  | {
      citation: Omit<ChatCitation, 'end_index' | 'start_index'>
      type: 'citation_start'
    }
  | {
      citationUuid: string
      type: 'citation_end'
    }
  | {
      text: string
      type: 'text'
    }

function toCitation(result: SearchResult) {
  return {
    metadata: result.metadata ?? null,
    origin_tool_name: 'web_search',
    sources: [
      {
        icon_url: result.metadata?.favicon_url ?? null,
        source: result.metadata?.site_name ?? result.metadata?.site_domain ?? null,
        title: result.title ?? null,
        url: result.url ?? null,
        uuid: 'citation-source-apidog-pricing',
      },
    ],
    title: result.title ?? null,
    url: result.url ?? null,
    uuid: 'citation-apidog-pricing',
  } satisfies Omit<ChatCitation, 'end_index' | 'start_index'>
}

function buildMockReplySegments(
  body: ChatCompletionRequest,
  query: string,
  searchResults: SearchResult[],
) {
  const prompt = body.prompt.trim()
  const citationResult = searchResults[2] ?? searchResults[0]
  const citation = toCitation(citationResult)

  return [
    {
      text:
        body.trigger === 'regenerate'
          ? prompt
            ? `Regenerated response to: **${prompt}**\n\n`
            : `Regenerated response for user message \`${body.parent_message_uuid}\`\n\n`
          : `Mock response to: **${query}**\n\n`,
      type: 'text',
    },
    {
      citation,
      type: 'citation_start',
    },
    {
      text: '每五小时 30–150 个本地任务（含周限额），支持 CLI 和 IDE 集成',
      type: 'text',
    },
    {
      citationUuid: citation.uuid,
      type: 'citation_end',
    },
    {
      text: [
        '。',
        '',
        `- \`web_search\` returned ${searchResults.length} knowledge items`,
        '- Citation pills should appear inline after the cited span',
        '- Markdown formatting should remain intact while the text streams in',
      ].join('\n'),
      type: 'text',
    },
  ] satisfies MockReplySegment[]
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
