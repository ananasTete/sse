import type { ChangeEventHandler } from 'react'
import { useReducer, useRef } from 'react'
import { v7 as generateTimeOrderedUuid } from 'uuid'

import { consumeChatCompletionStream } from './chat-stream'
import {
  CHAT_COMPLETION_PATH,
  DEFAULT_MODEL,
  ROOT_PARENT_MESSAGE_UUID,
} from './constants'
import { createUserMessage } from './message-builders'
import {
  chatReducer,
  getBranchState as selectBranchChildUuids,
  getMessageByUuid,
  initialChatState,
  selectCurrentBranchMessages,
} from './state'
import { toChatTimestamp } from './time'
import type {
  ChatCompletionRequest,
  ChatStatus,
  SendMessageInput,
} from './types'

export interface UseChatResult {
  getBranchState: (assistantMessageUuid: string) => string[]
  input: string
  messages: ReturnType<typeof selectCurrentBranchMessages>
  onInputChange: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>
  regenerate: (assistantMessageUuid: string) => Promise<void>
  selectBranch: (assistantMessageUuid: string) => void
  sendMessage: (message: SendMessageInput) => Promise<void>
  status: ChatStatus
  stop: () => void
}

interface ActiveRequest {
  assistantMessageUuid: string
  controller: AbortController
}

function getMessageText(messageContent: { text: string }[]) {
  return messageContent.map((block) => block.text).join('')
}

export function useChat(): UseChatResult {
  const [state, dispatch] = useReducer(chatReducer, initialChatState)
  const activeRequestRef = useRef<ActiveRequest | null>(null) // 当前进行中请求信息，可以取消请求
  const messages = selectCurrentBranchMessages(state)

  const onInputChange: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement> =
    (event) => {
      dispatch({
        input: event.target.value,
        type: 'input-changed',
      })
    }

  const stop = () => {
    const request = activeRequestRef.current

    if (!request) {
      return
    }

    activeRequestRef.current = null
    request.controller.abort()

    dispatch({
      messageUuid: request.assistantMessageUuid,
      stoppedAt: toChatTimestamp(),
      type: 'message-stream-stopped',
    })
  }

  const ensureRequestIsIdle = () => {
    if (state.status === 'submitted' || state.status === 'streaming') {
      throw new Error('A message is already being generated.')
    }
  }

  const runCompletionRequest = async (
    body: ChatCompletionRequest,
    abortController: AbortController,
  ) => {
    const response = await fetch(CHAT_COMPLETION_PATH, {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: abortController.signal,
    })

    await consumeChatCompletionStream({
      dispatch,
      onAssistantMessageStarted: (serverAssistantMessageUuid) => {
        const request = activeRequestRef.current

        if (request?.controller !== abortController) {
          return
        }

        request.assistantMessageUuid = serverAssistantMessageUuid
      },
      response,
    })
  }

  const sendMessage = async ({
    attachments = [],
    files = [],
    prompt,
  }: SendMessageInput) => {
    const normalizedPrompt = prompt.trim()

    if (!normalizedPrompt) {
      throw new Error('Prompt cannot be empty.')
    }

    ensureRequestIsIdle()

    const userMessageUuid = generateTimeOrderedUuid()
    const assistantMessageUuid = generateTimeOrderedUuid()
    const parentMessageUuid =
      state.current_leaf_message_uuid ?? ROOT_PARENT_MESSAGE_UUID

    dispatch({
      message: createUserMessage({
        attachments,
        files,
        parentMessageUuid,
        prompt: normalizedPrompt,
        uuid: userMessageUuid,
      }),
      type: 'request-message-added',
    })

    const abortController = new AbortController()
    activeRequestRef.current = {
      assistantMessageUuid,
      controller: abortController,
    }

    try {
      await runCompletionRequest(
        {
          attachments,
          files,
          model: DEFAULT_MODEL,
          parent_message_uuid: parentMessageUuid,
          prompt: normalizedPrompt,
          trigger: 'submit',
          turn_message_uuids: {
            assistant_message_uuid: assistantMessageUuid,
            user_message_uuid: userMessageUuid,
          },
        },
        abortController,
      )
    } catch (error) {
      if (abortController.signal.aborted) {
        return
      }

      dispatch({
        type: 'message-stream-failed',
      })

      console.error(error)

      throw error instanceof Error
        ? error
        : new Error('Chat completion stream failed.')
    } finally {
      if (activeRequestRef.current?.controller === abortController) {
        activeRequestRef.current = null
      }
    }
  }

  const regenerate = async (assistantMessageUuid: string) => {
    ensureRequestIsIdle()

    const assistantMessage = getMessageByUuid(state, assistantMessageUuid)

    if (!assistantMessage || assistantMessage.role !== 'assistant') {
      throw new Error('Only assistant messages can be regenerated.')
    }

    const parentMessageUuid = assistantMessage.parent_message_uuid
    const parentMessage = getMessageByUuid(state, parentMessageUuid)

    if (!parentMessage || parentMessage.role !== 'user') {
      throw new Error('Regenerate requires a parent user message.')
    }

    const nextAssistantMessageUuid = generateTimeOrderedUuid()
    const abortController = new AbortController()

    dispatch({
      type: 'request-submitted',
    })

    activeRequestRef.current = {
      assistantMessageUuid: nextAssistantMessageUuid,
      controller: abortController,
    }

    try {
      await runCompletionRequest(
        {
          attachments: parentMessage.attachments,
          files: parentMessage.files,
          model: DEFAULT_MODEL,
          parent_message_uuid: parentMessageUuid,
          prompt: getMessageText(parentMessage.content),
          trigger: 'regenerate',
          turn_message_uuids: {
            assistant_message_uuid: nextAssistantMessageUuid,
            user_message_uuid: parentMessage.uuid,
          },
        },
        abortController,
      )
    } catch (error) {
      if (abortController.signal.aborted) {
        return
      }

      dispatch({
        type: 'message-stream-failed',
      })

      console.error(error)

      throw error instanceof Error
        ? error
        : new Error('Chat completion stream failed.')
    } finally {
      if (activeRequestRef.current?.controller === abortController) {
        activeRequestRef.current = null
      }
    }
  }

  const getBranchState = (assistantMessageUuid: string) =>
    selectBranchChildUuids(state, assistantMessageUuid)

  const selectBranch = (assistantMessageUuid: string) => {
    ensureRequestIsIdle()

    dispatch({
      messageUuid: assistantMessageUuid,
      type: 'branch-selected',
    })
  }

  return {
    getBranchState,
    input: state.input,
    messages,
    onInputChange,
    regenerate,
    selectBranch,
    sendMessage,
    status: state.status,
    stop,
  }
}
