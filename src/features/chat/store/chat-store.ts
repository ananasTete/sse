import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { v7 as generateTimeOrderedUuid } from 'uuid'
import {
  chatReducer,
  createHydratedChatState,
  initialChatState,
  type ChatState,
  type ChatAction
} from '../state/chat-state'
import { consumeChatCompletionStream } from '../utils/chat-stream'
import { getChatCompletionPath } from '../api/conversation-api'
import { createUserMessage } from '../utils/message-builders'
import { getMessageByUuid } from '../state/chat-selectors'
import { toChatTimestamp } from '../utils/time'
import {
  DEFAULT_MODEL,
  ROOT_PARENT_MESSAGE_UUID,
} from '../models/constants'
import type {
  ChatCompletionRequest,
  EditUserMessageInput,
  RegenerateMessageInput,
  SendMessageInput,
} from '../models/chat'

interface ActiveRequest {
  assistantMessageUuid: string
  controller: AbortController
}

interface ConversationState extends ChatState {
  activeRequest: ActiveRequest | null
}

interface ChatStore {
  conversations: Record<string, ConversationState>
  initConversation: (id: string, initialLeaf?: string | null, mapping?: ChatState['mapping']) => void
  dispatch: (id: string, action: ChatAction) => void
  sendMessage: (id: string, input: SendMessageInput) => Promise<void>
  regenerateUserMessage: (id: string, userMessageUuid: string, input?: RegenerateMessageInput) => Promise<void>
  editUserMessage: (id: string, userMessageUuid: string, input: EditUserMessageInput) => Promise<void>
  regenerate: (id: string, assistantMessageUuid: string, input?: RegenerateMessageInput) => Promise<void>
  selectBranch: (id: string, messageUuid: string) => void
  stop: (id: string) => void
}

export const useChatStore = create<ChatStore>()(
  immer((set, get) => ({
    conversations: {},

    initConversation: (id, initialLeaf, mapping) => {
      set((draft) => {
        if (!draft.conversations[id]) {
          draft.conversations[id] = {
            ...createHydratedChatState({
              currentLeafMessageUuid: initialLeaf ?? null,
              mapping: mapping ?? initialChatState.mapping,
            }),
            activeRequest: null,
          }
        }
      })
    },

    dispatch: (id, action) => {
      set((draft) => {
        const conv = draft.conversations[id]
        if (!conv) return
        const nextState = chatReducer(conv, action)
        Object.assign(conv, nextState)
      })
    },

    stop: (id) => {
      const conv = get().conversations[id]
      const request = conv?.activeRequest

      if (!request) {
        return
      }

      request.controller.abort()

      get().dispatch(id, {
        messageUuid: request.assistantMessageUuid,
        stoppedAt: toChatTimestamp(),
        type: 'message-stream-stopped',
      })

      set((draft) => {
        if (draft.conversations[id]) {
          draft.conversations[id].activeRequest = null
        }
      })
    },

    sendMessage: async (id, { files = [], model, parentMessageUuid: inputParentMessageUuid, prompt }) => {
      const state = get().conversations[id]
      if (!state) return

      const normalizedPrompt = prompt.trim()
      const messageModel = model ?? DEFAULT_MODEL

      if (!normalizedPrompt) {
        throw new Error('Prompt cannot be empty.')
      }

      if (state.status === 'submitted' || state.status === 'streaming') {
        throw new Error('A message is already being generated.')
      }

      const userMessageUuid = generateTimeOrderedUuid()
      const assistantMessageUuid = generateTimeOrderedUuid()
      const parentMessageUuid = inputParentMessageUuid ?? state.current_leaf_message_uuid ?? ROOT_PARENT_MESSAGE_UUID

      get().dispatch(id, {
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

      set((draft) => {
        if (draft.conversations[id]) {
          draft.conversations[id].activeRequest = {
            assistantMessageUuid,
            controller: abortController,
          }
        }
      })

      try {
        const response = await fetch(getChatCompletionPath(id), {
          body: JSON.stringify({
            files,
            model: messageModel,
            parent_message_uuid: parentMessageUuid,
            prompt: normalizedPrompt,
            trigger: 'submit',
            turn_message_uuids: {
              assistant_message_uuid: assistantMessageUuid,
              user_message_uuid: userMessageUuid,
            },
          } satisfies ChatCompletionRequest),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          signal: abortController.signal,
        })

        await consumeChatCompletionStream({
          dispatch: (action) => get().dispatch(id, action),
          onAssistantMessageStarted: (serverAssistantMessageUuid) => {
            set((draft) => {
              const req = draft.conversations[id]?.activeRequest
              if (req && req.controller === abortController) {
                req.assistantMessageUuid = serverAssistantMessageUuid
              }
            })
          },
          response,
        })
      } catch (error) {
        if (abortController.signal.aborted) return

        get().dispatch(id, { type: 'message-stream-failed' })
        console.error(error)
        throw error instanceof Error ? error : new Error('Chat completion stream failed.')
      } finally {
        set((draft) => {
          if (draft.conversations[id]?.activeRequest?.controller === abortController) {
            draft.conversations[id].activeRequest = null
          }
        })
      }
    },

    regenerateUserMessage: async (id, userMessageUuid, input) => {
      const state = get().conversations[id]
      if (!state) return

      if (state.status === 'submitted' || state.status === 'streaming') {
        throw new Error('A message is already being generated.')
      }

      const parentMessage = getMessageByUuid(state, userMessageUuid)

      if (!parentMessage || parentMessage.role !== 'user') {
        throw new Error('Regenerate requires a user message.')
      }

      const nextAssistantMessageUuid = generateTimeOrderedUuid()
      const abortController = new AbortController()

      get().dispatch(id, { type: 'request-submitted' })

      set((draft) => {
        if (draft.conversations[id]) {
          draft.conversations[id].activeRequest = {
            assistantMessageUuid: nextAssistantMessageUuid,
            controller: abortController,
          }
        }
      })

      try {
        const response = await fetch(getChatCompletionPath(id), {
          body: JSON.stringify({
            files: parentMessage.files,
            model: input?.model ?? parentMessage.model ?? DEFAULT_MODEL,
            parent_message_uuid: parentMessage.uuid,
            prompt: input?.prompt ?? '',
            trigger: 'regenerate',
            turn_message_uuids: {
              assistant_message_uuid: nextAssistantMessageUuid,
            },
          } satisfies ChatCompletionRequest),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          signal: abortController.signal,
        })

        await consumeChatCompletionStream({
          dispatch: (action) => get().dispatch(id, action),
          onAssistantMessageStarted: (serverAssistantMessageUuid) => {
            set((draft) => {
              const req = draft.conversations[id]?.activeRequest
              if (req && req.controller === abortController) {
                req.assistantMessageUuid = serverAssistantMessageUuid
              }
            })
          },
          response,
        })
      } catch (error) {
        if (abortController.signal.aborted) return

        get().dispatch(id, { type: 'message-stream-failed' })
        console.error(error)
        throw error instanceof Error ? error : new Error('Chat completion stream failed.')
      } finally {
        set((draft) => {
          if (draft.conversations[id]?.activeRequest?.controller === abortController) {
            draft.conversations[id].activeRequest = null
          }
        })
      }
    },

    editUserMessage: async (id, userMessageUuid, input) => {
      const state = get().conversations[id]
      if (!state) return

      const userMessage = getMessageByUuid(state, userMessageUuid)

      if (!userMessage || userMessage.role !== 'user') {
        throw new Error('Edit requires a user message.')
      }

      await get().sendMessage(id, {
        files: userMessage.files,
        model: input.model,
        parentMessageUuid: userMessage.parent_message_uuid,
        prompt: input.prompt,
      })
    },

    regenerate: async (id, assistantMessageUuid, input) => {
      const state = get().conversations[id]
      if (!state) return

      const assistantMessage = getMessageByUuid(state, assistantMessageUuid)

      if (!assistantMessage || assistantMessage.role !== 'assistant') {
        throw new Error('Only assistant messages can be regenerated.')
      }

      await get().regenerateUserMessage(id, assistantMessage.parent_message_uuid, {
        ...input,
        model: input?.model ?? assistantMessage.model,
      })
    },

    selectBranch: (id, messageUuid) => {
      const state = get().conversations[id]
      if (!state) return

      if (state.status === 'submitted' || state.status === 'streaming') {
        throw new Error('A message is already being generated.')
      }

      get().dispatch(id, {
        messageUuid,
        type: 'branch-selected',
      })
    },
  }))
)
