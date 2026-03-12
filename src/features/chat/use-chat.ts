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
  EditUserMessageInput,
  RegenerateMessageInput,
  SendMessageInput,
} from './types'

export interface UseChatResult {
  appendInput: (text: string) => void
  getBranchState: (parentMessageUuid: string) => string[]
  input: string
  messages: ReturnType<typeof selectCurrentBranchMessages>
  onInputChange: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>
  regenerate: (
    assistantMessageUuid: string,
    input?: RegenerateMessageInput,
  ) => Promise<void>
  regenerateUserMessage: (
    userMessageUuid: string,
    input?: RegenerateMessageInput,
  ) => Promise<void>
  editUserMessage: (
    userMessageUuid: string,
    input: EditUserMessageInput,
  ) => Promise<void>
  selectBranch: (messageUuid: string) => void
  sendMessage: (message: SendMessageInput) => Promise<void>
  status: ChatStatus
  stop: () => void
}

interface ActiveRequest {
  assistantMessageUuid: string
  controller: AbortController
}

export function useChat(): UseChatResult {
  const [state, dispatch] = useReducer(chatReducer, initialChatState)
  const activeRequestRef = useRef<ActiveRequest | null>(null) // 当前进行中请求信息，可以取消请求
  const messages = selectCurrentBranchMessages(state)

  const appendInput = (text: string) => {
    const normalizedText = text.trim()

    if (!normalizedText) {
      return
    }

    dispatch({
      text: normalizedText,
      type: 'input-appended',
    })
  }

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
    files = [],
    model,
    parentMessageUuid: inputParentMessageUuid,
    prompt,
  }: SendMessageInput) => {
    const normalizedPrompt = prompt.trim()
    const messageModel = model ?? DEFAULT_MODEL

    if (!normalizedPrompt) {
      throw new Error('Prompt cannot be empty.')
    }

    ensureRequestIsIdle()

    const userMessageUuid = generateTimeOrderedUuid()
    const assistantMessageUuid = generateTimeOrderedUuid()
    const parentMessageUuid =
      inputParentMessageUuid ??
      state.current_leaf_message_uuid ??
      ROOT_PARENT_MESSAGE_UUID

    dispatch({
      message: createUserMessage({
        files,
        model: messageModel,
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
      // TODO: When uploads are wired in, fetch each uploaded file object
      // immediately after upload for local preview and pending-message rendering.
      // The completion API should still receive only `files: string[]` ids here.
      await runCompletionRequest(
        {
          files,
          model: messageModel,
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

  const regenerateUserMessage = async (
    userMessageUuid: string,
    input?: RegenerateMessageInput,
  ) => {
    ensureRequestIsIdle()

    const parentMessage = getMessageByUuid(state, userMessageUuid)

    if (!parentMessage || parentMessage.role !== 'user') {
      throw new Error('Regenerate requires a user message.')
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
          files: parentMessage.files,
          model: input?.model ?? parentMessage.model ?? DEFAULT_MODEL,
          parent_message_uuid: parentMessage.uuid,
          prompt: input?.prompt ?? '',
          trigger: 'regenerate',
          turn_message_uuids: {
            assistant_message_uuid: nextAssistantMessageUuid,
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

  const editUserMessage = async (
    userMessageUuid: string,
    input: EditUserMessageInput,
  ) => {
    const userMessage = getMessageByUuid(state, userMessageUuid)

    if (!userMessage || userMessage.role !== 'user') {
      throw new Error('Edit requires a user message.')
    }

    await sendMessage({
      files: userMessage.files,
      model: input.model,
      parentMessageUuid: userMessage.parent_message_uuid,
      prompt: input.prompt,
    })
  }

  const regenerate = async (
    assistantMessageUuid: string,
    input?: RegenerateMessageInput,
  ) => {
    const assistantMessage = getMessageByUuid(state, assistantMessageUuid)

    if (!assistantMessage || assistantMessage.role !== 'assistant') {
      throw new Error('Only assistant messages can be regenerated.')
    }

    await regenerateUserMessage(assistantMessage.parent_message_uuid, {
      ...input,
      model: input?.model ?? assistantMessage.model,
    })
  }

  const getBranchState = (parentMessageUuid: string) =>
    selectBranchChildUuids(state, parentMessageUuid)

  const selectBranch = (messageUuid: string) => {
    ensureRequestIsIdle()

    dispatch({
      messageUuid,
      type: 'branch-selected',
    })
  }

  return {
    appendInput,
    getBranchState,
    editUserMessage,
    input: state.input,
    messages,
    onInputChange,
    regenerate,
    regenerateUserMessage,
    selectBranch,
    sendMessage,
    status: state.status,
    stop,
  }
}
