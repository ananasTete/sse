import { createSseParser } from './sse'
import { toChatTimestamp } from './time'
import { createAssistantMessage, createContentBlock } from './message-builders'
import type {
  ChatCompletionContentBlockDeltaEvent,
  ChatCompletionContentBlockStartEvent,
  ChatCompletionContentBlockStopEvent,
  ChatCompletionMessageDeltaEvent,
  ChatCompletionMessageLimitEvent,
  ChatCompletionMessageStartEvent,
} from './types'
import type { ChatAction } from './state'

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

        dispatch({
          index: payload.index,
          messageUuid: getAssistantMessageUuidOrThrow(event),
          type: 'content-block-started',
          value: createContentBlock(payload),
        })
        break
      }

      case 'content_block_delta': {
        const payload = JSON.parse(data) as ChatCompletionContentBlockDeltaEvent

        dispatch({
          index: payload.index,
          messageUuid: getAssistantMessageUuidOrThrow(event),
          text: payload.delta.text,
          type: 'content-block-delta-received',
          updatedAt: toChatTimestamp(),
        })
        break
      }

      case 'content_block_stop': {
        const payload = JSON.parse(data) as ChatCompletionContentBlockStopEvent

        dispatch({
          index: payload.index,
          messageUuid: getAssistantMessageUuidOrThrow(event),
          stopTimestamp: payload.stop_timestamp,
          type: 'content-block-stopped',
        })
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
