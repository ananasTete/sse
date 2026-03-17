import { createFileRoute } from '@tanstack/react-router'
import { getISOTimestamp } from '#/features/chat/utils/time'
import { abortMessage } from '#/features/chat/server/events/event-bus'
import { mutateConversation } from '#/features/chat/server'

export const Route = createFileRoute('/api/chat_conversations/$conversationId/cancel')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const body = await request.json() as { message_id: string }
        const { message_id } = body
        const stoppedAt = getISOTimestamp()

        if (!message_id) {
          return Response.json({ error: 'message_id is required' }, { status: 400 })
        }

        // Mark as aborted in event-bus
        abortMessage(message_id)

        // Also update conversation state
        try {
          mutateConversation(params.conversationId, (conversation) => {
            const message = conversation.mapping[message_id]?.message
            if (
              message &&
              message.role === 'assistant' &&
              message.stop_reason === null
            ) {
              message.stop_reason = 'user_canceled'
              message.updated_at = stoppedAt
              
              // Stop all content blocks
              for (const block of message.content) {
                block.stop_timestamp ??= stoppedAt
              }
            }
          })
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : 'Conversation not found' },
            { status: 404 }
          )
        }

        return Response.json({ success: true })
      }
    }
  }
})
