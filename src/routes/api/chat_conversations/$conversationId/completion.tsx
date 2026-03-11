import { createFileRoute } from '@tanstack/react-router'
import { formatSseEvent } from '#/features/chat/sse'
import { toChatTimestamp } from '#/features/chat/time'
import type {
  ChatCitation,
  ChatCompletionRequest,
} from '#/features/chat/types'

export const Route = createFileRoute(
  '/api/chat_conversations/$conversationId/completion',
)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as ChatCompletionRequest
        const encoder = new TextEncoder()
        const assistantParentUuid =
          body.trigger === 'regenerate'
            ? body.parent_message_uuid
            : body.turn_message_uuids.user_message_uuid
        const query = buildSearchQuery(body)
        const searchResults = buildSearchResults(query)
        const replySegments = buildMockReplySegments(body, query, searchResults)

        return new Response(
          new ReadableStream({
            async start(controller) {
              let closed = false

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
                close()
              }

              request.signal.addEventListener('abort', abortListener)

              try {
                const toolUseId = `toolu_${body.turn_message_uuids.assistant_message_uuid.replaceAll('-', '')}`

                if (
                  !enqueue(
                    formatSseEvent('message_start', {
                      message: {
                        content: [],
                        id: `chatcompl_${body.turn_message_uuids.assistant_message_uuid.replaceAll('-', '')}`,
                        model: body.model,
                        parent_uuid: assistantParentUuid,
                        role: 'assistant',
                        stop_reason: null,
                        stop_sequence: null,
                        type: 'message',
                        uuid: body.turn_message_uuids.assistant_message_uuid,
                      },
                      type: 'message_start',
                    }),
                  )
                ) {
                  return
                }

                await sleep(280)

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
                        start_timestamp: toChatTimestamp(),
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
                }

                await sleep(900)

                if (
                  !enqueue(
                    formatSseEvent('content_block_delta', {
                      delta: {
                        display_content: {
                          preview_url: searchResults[0]?.url ?? null,
                        },
                        message: `Fetching: ${searchResults[0]?.url ?? query}`,
                        type: 'tool_use_block_update_delta',
                      },
                      index: 0,
                      type: 'content_block_delta',
                    }),
                  )
                ) {
                  return
                }

                await sleep(900)

                if (
                  !enqueue(
                    formatSseEvent('content_block_stop', {
                      index: 0,
                      stop_timestamp: toChatTimestamp(),
                      type: 'content_block_stop',
                    }),
                  )
                ) {
                  return
                }

                await sleep(700)

                if (
                  !enqueue(
                    formatSseEvent('content_block_start', {
                      content_block: {
                        display_content: null,
                        flags: null,
                        icon_name: 'globe',
                        is_error: false,
                        message: `Found ${searchResults.length} sources`,
                        name: 'web_search',
                        start_timestamp: toChatTimestamp(),
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
                }

                await sleep(1000)

                if (
                  !enqueue(
                    formatSseEvent('content_block_stop', {
                      index: 1,
                      stop_timestamp: toChatTimestamp(),
                      type: 'content_block_stop',
                    }),
                  )
                ) {
                  return
                }

                await sleep(650)

                if (
                  !enqueue(
                    formatSseEvent('content_block_start', {
                      content_block: {
                        citations: [],
                        flags: null,
                        start_timestamp: toChatTimestamp(),
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
                  }
                }

                await sleep(180)

                if (
                  !enqueue(
                    formatSseEvent('content_block_stop', {
                      index: 2,
                      stop_timestamp: toChatTimestamp(),
                      type: 'content_block_stop',
                    }),
                  )
                ) {
                  return
                }

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

                await sleep(120)

                if (
                  !enqueue(
                    formatSseEvent('message_limit', {
                      message_limit: {
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
                      },
                      type: 'message_limit',
                    }),
                  )
                ) {
                  return
                }

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
