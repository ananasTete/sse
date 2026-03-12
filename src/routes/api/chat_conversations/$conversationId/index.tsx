import { createFileRoute } from '@tanstack/react-router'
import { getConversation } from '#/features/chat/conversation-store'

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

          return Response.json(conversation)
        },
      },
    },
  },
)
