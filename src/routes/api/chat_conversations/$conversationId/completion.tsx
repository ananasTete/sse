import { createFileRoute } from '@tanstack/react-router'
import {
  getISOTimestamp,
} from '#/features/chat/utils/time'
import { runBackgroundGeneration } from '#/features/chat/server/events/generator'
import {
  mutateConversation,
  updateConversationSummaryFields,
} from '#/features/chat/server'
import {
  getHistory,
  isCompleted,
  subscribeToMessage,
} from '#/features/chat/server/events/event-bus'
import type {
  ChatCompletionRequest,
  ChatMessage,
} from '#/features/chat/models'
import { v7 as generateTimeOrderedUuid } from 'uuid'

export const Route = createFileRoute(
  '/api/chat_conversations/$conversationId/completion',
)({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const body = (await request.json()) as ChatCompletionRequest
        let assistantTimestamp = getISOTimestamp()
        
        // Generate message IDs
        const assistantMessageUuid = body.turn_message_uuids.assistant_message_uuid || generateTimeOrderedUuid()
        let assistantParentUuid = body.parent_uuid
        const toolUseId = generateTimeOrderedUuid()

        // Initialize the assistant message in conversation
        mutateConversation(params.conversationId, (conversation) => {
          let userMessage: ChatMessage | null | undefined = null
          
          if (body.trigger === 'submit') {
            const userMessageUuid = body.turn_message_uuids.user_message_uuid
            const parentUuid = body.parent_uuid
            const userTimestamp = getISOTimestamp()
            
            // Create user message first
            userMessage = {
              content: [{
                citations: [],
                start_timestamp: userTimestamp,
                stop_timestamp: userTimestamp,
                text: body.prompt,
                type: 'text'
              }],
              created_at: userTimestamp,
              files: body.files,
              metadata: {},
              model: body.model,
              parent_uuid: parentUuid,
              role: 'user',
              stop_reason: null,
              updated_at: userTimestamp,
              uuid: userMessageUuid,
              index: 0,
            }
            
            const maxIndex = Math.max(
              ...Object.values(conversation.mapping)
                .map(node => node.message?.index ?? -1)
            )
            userMessage.index = maxIndex + 1

            conversation.mapping[userMessageUuid] = {
              child_uuids: [],
              message: userMessage,
              parent_uuid: parentUuid,
              uuid: userMessageUuid,
            }

            const parentNode = conversation.mapping[parentUuid]
            if (parentNode) {
              parentNode.child_uuids.push(userMessageUuid)
            }
            
            assistantParentUuid = userMessageUuid
          } else {
            // regenerate
            assistantParentUuid = body.parent_uuid
            userMessage = conversation.mapping[assistantParentUuid]?.message
            if (!userMessage) {
              throw new Error('Parent message not found')
            }
          }

          // Create assistant message
          assistantTimestamp = getISOTimestamp()
          const assistantMessage: ChatMessage = {
            content: [],
            created_at: assistantTimestamp,
            files: [],
            metadata: {},
            model: body.model,
            parent_uuid: assistantParentUuid,
            role: 'assistant',
            stop_reason: null,
            updated_at: assistantTimestamp,
            uuid: assistantMessageUuid,
            index: 0, // Will be updated below
          }
          
          // Assign index
          const maxIndex2 = Math.max(
            ...Object.values(conversation.mapping)
              .map(node => node.message?.index ?? -1)
          )
          assistantMessage.index = maxIndex2 + 1

          conversation.mapping[assistantMessageUuid] = {
            child_uuids: [],
            message: assistantMessage,
            parent_uuid: assistantParentUuid,
            uuid: assistantMessageUuid,
          }

          // Update parent's children
          const parentNode = conversation.mapping[assistantParentUuid]
          if (parentNode) {
            parentNode.child_uuids.push(assistantMessageUuid)
          }

          // Update conversation summary
          updateConversationSummaryFields(conversation, {
            currentLeafMessageUuid: assistantMessageUuid,
            updatedAt: assistantTimestamp
          })
        })

        // Start background generation (fire and forget)
        runBackgroundGeneration({
          assistantMessageUuid,
          assistantTimestamp,
          body,
          assistantParentUuid,
          toolUseId,
        }).catch(error => {
          console.error('Background generation failed:', error)
        })

        const encoder = new TextEncoder()

        return new Response(
          new ReadableStream({
            start(controller) {
              let closed = false

              const close = () => {
                if (closed) return
                closed = true
                try {
                  controller.close()
                } catch (_e) {}
              }

              const enqueue = (chunk: string) => {
                if (closed || request.signal.aborted) return false
                controller.enqueue(encoder.encode(chunk))
                return true
              }

              // Replay any history that might have been generated synchronously before start()
              const history = getHistory(assistantMessageUuid)
              for (const event of history) {
                if (!enqueue(event)) return
              }

              if (isCompleted(assistantMessageUuid)) {
                close()
                return
              }

              // Subscribe to new events
              const unsubscribe = subscribeToMessage(assistantMessageUuid, (eventStr) => {
                if (!enqueue(eventStr)) return

                if (eventStr.includes('event: message_stop')) {
                  close()
                  unsubscribe()
                }
              })

              request.signal.addEventListener('abort', () => {
                unsubscribe()
                close()
              })
            },
          }),
          {
            headers: {
              'Cache-Control': 'no-cache, no-transform',
              'Content-Type': 'text/event-stream',
            },
          }
        )
      }
    }
  }
})
