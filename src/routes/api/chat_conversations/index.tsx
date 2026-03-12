import { createFileRoute } from '@tanstack/react-router'
import {
  createConversation,
  listConversations,
} from '#/features/chat/conversation-store'

export const Route = createFileRoute('/api/chat_conversations/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const cursor = url.searchParams.get('cursor')

        return Response.json(
          listConversations({
            cursor,
          }),
        )
      },
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          uuid?: string
        }

        if (!body.uuid) {
          return Response.json(
            { error: 'Missing conversation uuid.' },
            { status: 400 },
          )
        }

        try {
          return Response.json(createConversation(body.uuid))
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to create conversation.',
            },
            { status: 409 },
          )
        }
      },
    },
  },
})
