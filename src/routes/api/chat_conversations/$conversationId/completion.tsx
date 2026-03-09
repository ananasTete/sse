import { createFileRoute } from '@tanstack/react-router'
import { formatSseEvent } from '#/features/chat/sse'
import { toChatTimestamp } from '#/features/chat/time'
import type { ChatCompletionRequest } from '#/features/chat/types'

export const Route = createFileRoute(
  '/api/chat_conversations/$conversationId/completion',
)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as ChatCompletionRequest
        const encoder = new TextEncoder()
        const reply = buildMockReply(body.prompt, body.trigger)
        const assistantParentUuid =
          body.trigger === 'regenerate'
            ? body.parent_message_uuid
            : body.turn_message_uuids.user_message_uuid

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
                const blockStartTimestamp = toChatTimestamp()

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

                await sleep(60)

                if (
                  !enqueue(
                    formatSseEvent('content_block_start', {
                      content_block: {
                        citations: [],
                        flags: null,
                        start_timestamp: blockStartTimestamp,
                        stop_timestamp: null,
                        text: '',
                        type: 'text',
                      },
                      index: 0,
                      type: 'content_block_start',
                    }),
                  )
                ) {
                  return
                }

                for (const chunk of chunkText(reply)) {
                  await sleep(45)

                  if (
                    !enqueue(
                      formatSseEvent('content_block_delta', {
                        delta: {
                          text: chunk,
                          type: 'text_delta',
                        },
                        index: 0,
                        type: 'content_block_delta',
                      }),
                    )
                  ) {
                    return
                  }
                }

                const blockStopTimestamp = toChatTimestamp()

                await sleep(45)

                if (
                  !enqueue(
                    formatSseEvent('content_block_stop', {
                      index: 0,
                      stop_timestamp: blockStopTimestamp,
                      type: 'content_block_stop',
                    }),
                  )
                ) {
                  return
                }

                await sleep(20)

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

                await sleep(20)

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
  const tokens = text.match(/.{1,8}/g)

  return tokens?.length ? tokens : [text]
}

function buildMockReply(
  prompt: string,
  trigger: ChatCompletionRequest['trigger'],
) {
  return [
    trigger === 'regenerate'
      ? `Regenerated response to: ${prompt}`
      : `Mock response to: ${prompt}`,
    '',
    'This is a longer streaming reply from the local mock server.',
    'It emits multiple chunks so the UI can render partial text, status changes, and stop behavior clearly.',
    '',
    'You can use this response to verify incremental rendering, auto-scroll, and assistant metadata updates.',
    'When the real backend is ready, this route can keep the same event shape and swap only the content source.',
  ].join('\n')
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
