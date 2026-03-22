import { createFileRoute } from '@tanstack/react-router'
import {
  getISOTimestamp,
} from '#/features/conversation/utils/time'
import { runBackgroundGeneration } from '#/server/events/generator'
import {
  mutateConversation,
  updateConversationSummaryFields,
} from '#/server'
import {
  getHistory,
  isCompleted,
  subscribeToMessage,
} from '#/server/events/event-bus'
import type {
  ChatCompletionRequest,
  ChatMessage,
} from '#/features/conversation/models'
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
            }

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
          }

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
              let historyReplayed = false

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

              // 1. Subscribe FIRST to catch any events that occur while we replay history.
              // This prevents a race condition where an event happens between getHistory() and subscribe().
              // Events received before historyReplayed is true are guaranteed to already be in the history
              // (because publishEvent is synchronous: push to history → notify subscribers),
              // so they are already included in the replay below.
              const unsubscribe = subscribeToMessage(assistantMessageUuid, (eventStr) => {
                if (!historyReplayed) return

                if (!enqueue(eventStr)) return

                if (eventStr.includes('event: message_stop')) {
                  close()
                  unsubscribe()
                }
              })

              // Handle disconnect
              request.signal.addEventListener('abort', () => {
                unsubscribe()
                close()
              })

              // 2. Replay any history that has been generated so far
              const history = getHistory(assistantMessageUuid)
              for (const event of history) {
                if (!enqueue(event)) return
              }

              // 3. Enable pass-through for the subscriber
              historyReplayed = true

              // 4. If already completed, close the stream.
              // If the stream completed after we subscribed but before this check,
              // the subscriber callback would handle it (now that historyReplayed is true).
              // If it completed before we subscribed, we need to manually close.
              if (isCompleted(assistantMessageUuid)) {
                if (!closed) {
                  close()
                  unsubscribe()
                }
              }
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
