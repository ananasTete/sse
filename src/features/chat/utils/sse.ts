import {
  createParser as createEventSourceParser,
  type EventSourceMessage,
  type ParseError,
} from 'eventsource-parser'

import type { ChatCompletionSseEvent } from '../models/chat'

export interface ParsedSseEvent {
  data: string
  event: string
}

/**
 * 对齐标准协议
 * SSE 协议的默认事件名是 "message"，但如果服务端没发 event: xxx， eventsource-parser 不会替你补这个默认值而是返回 undefined 
 */

function normalizeParsedEvent(event: EventSourceMessage) {
  return {
    data: event.data,
    event: event.event ?? 'message',
  } satisfies ParsedSseEvent
}

export function createSseParser(onEvent: (event: ParsedSseEvent) => void) {
  let parserError: ParseError | null = null
  const parser = createEventSourceParser({
    onError(error) {
      parserError = error
    },
    onEvent(event) {
      onEvent(normalizeParsedEvent(event))
    },
  })

  function throwIfParserErrored() {
    if (!parserError) {
      return
    }

    const error = parserError
    parserError = null
    throw error
  }

  return {
    reset() {
      parser.reset({ consume: true })
      // feed reset 都是同步的出错就会立刻调用 onError，所以可以在下方立即检查错误
      throwIfParserErrored()
    },
    feed(chunk: string) {
      parser.feed(chunk)
      throwIfParserErrored()
    },
  }
}

export function formatSseEvent(
  event: ChatCompletionSseEvent['type'],
  data: ChatCompletionSseEvent,
) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
