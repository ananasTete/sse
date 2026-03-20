import { createFileRoute } from '@tanstack/react-router'
import { getConversation, mutateConversation } from '#/server'
import { getHistory } from '#/server/events/event-bus'
import { reconstructMessageSnapshot } from '#/server/utils/snapshot'

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
        PATCH: async ({ params, request }) => {
          const body = (await request.json()) as {
            current_leaf_message_uuid?: string | null
          }

          if (!Object.hasOwn(body, 'current_leaf_message_uuid')) {
            return Response.json(
              { error: 'current_leaf_message_uuid is required.' },
              { status: 400 },
            )
          }

          try {
            const summary = mutateConversation(
              params.conversationId,
              (conversation) => {
                const nextLeafMessageUuid = body.current_leaf_message_uuid ?? null

                if (
                  nextLeafMessageUuid !== null &&
                  !conversation.mapping[nextLeafMessageUuid]
                ) {
                  throw new Error('Leaf message not found.')
                }

                conversation.current_leaf_message_uuid = nextLeafMessageUuid

                const { mapping: _mapping, ...rest } = conversation
                return rest
              },
            )

            return Response.json(summary)
          } catch (error) {
            return Response.json(
              {
                error:
                  error instanceof Error
                    ? error.message
                    : 'Failed to update conversation.',
              },
              { status: 404 },
            )
          }
        },
      },
    },
  },
)
