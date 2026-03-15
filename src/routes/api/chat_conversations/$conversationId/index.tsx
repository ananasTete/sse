import { createFileRoute } from '@tanstack/react-router'
import { getConversation } from '#/features/chat/server'
import { getHistory } from '#/features/chat/server/events/event-bus'
import { reconstructMessageSnapshot } from '#/features/chat/server/utils/snapshot'

export const Route = createFileRoute('/api/chat_conversations/$conversationId/')(
  {
    server: {
      handlers: {
        GET: async ({ params }) => {
          const conversation = getConversation(params.conversationId)

          if (!conversation) {
            return Response.json(
              { error: 'Conversation not found.' },
              { status: 404 },
            )
          }

          // Reconstruct the latest state of assistant messages from the event bus history
          // to ensure content and stop_reason are up to date.
          for (const node of Object.values(conversation.mapping)) {
            if (node.message && node.message.role === 'assistant') {
              const history = getHistory(node.message.uuid)
              if (history && history.length > 0) {
                const snapshot = reconstructMessageSnapshot(history)
                if (snapshot && snapshot.message) {
                  node.message.content = snapshot.message.content
                  node.message.metadata = {
                    ...node.message.metadata,
                    ...snapshot.message.metadata,
                  }
                  node.message.stop_reason = snapshot.message.stop_reason
                  node.message.updated_at = snapshot.message.updated_at
                }
              }
            }
          }

          return Response.json(conversation)
        },
      },
    },
  },
)
