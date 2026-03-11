import { createSseParser } from './sse'
import { toChatTimestamp } from './time'
import {
  createAssistantMessage,
  createContentBlock,
  createToolResultBlock,
} from './message-builders'
import type {
  ChatCitation,
  ChatCompletionContentBlockDeltaEvent,
  ChatCompletionContentBlockStartEvent,
  ChatCompletionContentBlockStopEvent,
  ChatCompletionMessageDeltaEvent,
  ChatCompletionMessageLimitEvent,
  ChatCompletionMessageStartEvent,
} from './types'
import type { ChatAction } from './state'

type ActiveContentBlock =
  | {
      openCitations: Map<
        string,
        {
          citation: Omit<ChatCitation, 'end_index' | 'start_index'>
          startIndex: number
        }
      >
      textLength: number
      type: 'text'
    }
  | {
      inputJsonBuffer: string
      toolUseId: string
      type: 'tool_use'
    }
  | {
      displayContentJsonBuffer: string
      toolUseId: string
      type: 'tool_result'
    }

function tryParseJson<T>(value: string) {
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

export function assertSuccessfulResponse(response: Response) {
  if (!response.ok) {
    throw new Error(`Chat completion request failed with status ${response.status}.`)
  }

  if (!response.body) {
    throw new Error('Chat completion response did not include a stream body.')
  }
}

export async function consumeChatCompletionStream({
  dispatch,
  onAssistantMessageStarted,
  response,
}: {
  dispatch: (action: ChatAction) => void
  onAssistantMessageStarted?: (assistantMessageUuid: string) => void
  response: Response
}) {
  assertSuccessfulResponse(response)

  const responseBody = response.body

  if (!responseBody) {
    throw new Error('Chat completion response did not include a stream body.')
  }

  const reader = responseBody.getReader()
  const decoder = new TextDecoder()
  let didReceiveMessageStop = false
  let assistantMessageUuid: string | null = null
  const activeContentBlocks = new Map<number, ActiveContentBlock>()

  const getAssistantMessageUuidOrThrow = (eventType: string) => {
    if (!assistantMessageUuid) {
      throw new Error(`Received ${eventType} before message_start.`)
    }

    return assistantMessageUuid
  }

  const parser = createSseParser(({ data, event }) => {
    switch (event) {
      case 'message_start': {
        const payload = JSON.parse(data) as ChatCompletionMessageStartEvent

        assistantMessageUuid = payload.message.uuid
        onAssistantMessageStarted?.(assistantMessageUuid)

        dispatch({
          message: createAssistantMessage(payload),
          type: 'request-message-added',
        })
        break
      }

      case 'content_block_start': {
        const payload = JSON.parse(data) as ChatCompletionContentBlockStartEvent

        const messageUuid = getAssistantMessageUuidOrThrow(event)

        switch (payload.content_block.type) {
          case 'text':
            activeContentBlocks.set(payload.index, {
              openCitations: new Map(),
              textLength: payload.content_block.text.length,
              type: 'text',
            })
            dispatch({
              index: payload.index,
              messageUuid,
              type: 'content-block-started',
              value: createContentBlock(payload),
            })
            break

          case 'tool_use':
            activeContentBlocks.set(payload.index, {
              inputJsonBuffer: '',
              toolUseId: payload.content_block.id,
              type: 'tool_use',
            })
            dispatch({
              index: payload.index,
              messageUuid,
              type: 'content-block-started',
              value: createContentBlock(payload),
            })
            break

          case 'tool_result':
            activeContentBlocks.set(payload.index, {
              displayContentJsonBuffer: '',
              toolUseId: payload.content_block.tool_use_id,
              type: 'tool_result',
            })
            dispatch({
              messageUuid,
              type: 'tool-result-started',
              value: createToolResultBlock(payload),
            })
            break
        }
        break
      }

      case 'content_block_delta': {
        const payload = JSON.parse(data) as ChatCompletionContentBlockDeltaEvent
        const messageUuid = getAssistantMessageUuidOrThrow(event)
        const updatedAt = toChatTimestamp()
        const activeBlock = activeContentBlocks.get(payload.index)

        if (!activeBlock) {
          break
        }

        switch (activeBlock.type) {
          case 'text':
            if (payload.delta.type === 'text_delta') {
              activeBlock.textLength += payload.delta.text.length
              dispatch({
                index: payload.index,
                messageUuid,
                text: payload.delta.text,
                type: 'text-block-delta-received',
                updatedAt,
              })
              break
            }

            if (payload.delta.type === 'citation_start_delta') {
              activeBlock.openCitations.set(payload.delta.citation.uuid, {
                citation: payload.delta.citation,
                startIndex: activeBlock.textLength,
              })
              break
            }

            if (payload.delta.type === 'citation_end_delta') {
              const openCitation = activeBlock.openCitations.get(
                payload.delta.citation_uuid,
              )

              if (!openCitation) {
                break
              }

              activeBlock.openCitations.delete(payload.delta.citation_uuid)
              dispatch({
                citation: {
                  ...openCitation.citation,
                  end_index: activeBlock.textLength,
                  start_index: openCitation.startIndex,
                },
                index: payload.index,
                messageUuid,
                type: 'text-block-citation-added',
                updatedAt,
              })
            }
            break

          case 'tool_use':
            if (payload.delta.type === 'input_json_delta') {
              activeBlock.inputJsonBuffer += payload.delta.partial_json
              const parsedInput = tryParseJson<Record<string, unknown> | null>(
                activeBlock.inputJsonBuffer,
              )

              if (parsedInput !== undefined) {
                dispatch({
                  index: payload.index,
                  input: parsedInput,
                  messageUuid,
                  type: 'tool-use-input-updated',
                  updatedAt,
                })
              }
            }

            if (payload.delta.type === 'tool_use_block_update_delta') {
              dispatch({
                displayContent: payload.delta.display_content,
                index: payload.index,
                message: payload.delta.message,
                messageUuid,
                type: 'tool-use-updated',
                updatedAt,
              })
            }
            break

          case 'tool_result':
            if (payload.delta.type === 'input_json_delta') {
              activeBlock.displayContentJsonBuffer += payload.delta.partial_json
              const parsedDisplayContent = tryParseJson<unknown>(
                activeBlock.displayContentJsonBuffer,
              )

              if (parsedDisplayContent !== undefined) {
                dispatch({
                  displayContent: parsedDisplayContent,
                  messageUuid,
                  toolUseId: activeBlock.toolUseId,
                  type: 'tool-result-updated',
                  updatedAt,
                })
              }
            }

            if (payload.delta.type === 'tool_result_block_update_delta') {
              dispatch({
                displayContent: payload.delta.display_content,
                isError: payload.delta.is_error,
                message: payload.delta.message,
                messageUuid,
                toolUseId: activeBlock.toolUseId,
                type: 'tool-result-updated',
                updatedAt,
              })
            }
            break
        }
        break
      }

      case 'content_block_stop': {
        const payload = JSON.parse(data) as ChatCompletionContentBlockStopEvent
        const activeBlock = activeContentBlocks.get(payload.index)

        if (activeBlock?.type === 'tool_result') {
          dispatch({
            messageUuid: getAssistantMessageUuidOrThrow(event),
            stopTimestamp: payload.stop_timestamp,
            toolUseId: activeBlock.toolUseId,
            type: 'tool-result-stopped',
          })
          activeContentBlocks.delete(payload.index)
          break
        }

        dispatch({
          index: payload.index,
          messageUuid: getAssistantMessageUuidOrThrow(event),
          stopTimestamp: payload.stop_timestamp,
          type: 'content-block-stopped',
        })
        activeContentBlocks.delete(payload.index)
        break
      }

      case 'message_delta': {
        const payload = JSON.parse(data) as ChatCompletionMessageDeltaEvent

        dispatch({
          messageUuid: getAssistantMessageUuidOrThrow(event),
          stopReason: payload.delta.stop_reason,
          type: 'message-stop-reason-updated',
          updatedAt: toChatTimestamp(),
        })
        break
      }

      case 'message_limit': {
        const payload = JSON.parse(data) as ChatCompletionMessageLimitEvent

        dispatch({
          messageUuid: getAssistantMessageUuidOrThrow(event),
          metadata: {
            message_limit: payload.message_limit,
          },
          type: 'message-metadata-updated',
          updatedAt: toChatTimestamp(),
        })
        break
      }

      case 'message_stop':
        didReceiveMessageStop = true
        dispatch({
          type: 'message-stream-finished',
        })
        break

      default:
        break
    }
  })

  /**
   * 1. read() 从网络流拿到字节块（字节数组）
   * 2. decode() 把字节块解码成文本字符串
   * 3. { stream: true } 因为一个 UTF-8 字符可能刚好被拆在两个 chunk 之间，它会帮你正确拼接，不会把多字节字符解坏。
   */
  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    parser.feed(decoder.decode(value, { stream: true }))
  }

  parser.reset()

  if (!didReceiveMessageStop) {
    throw new Error('Chat completion stream ended before message_stop.')
  }
}
