import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/stt/transcriptions')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const formData = await request.formData()
        const file = formData.get('file')

        if (!(file instanceof File)) {
          return Response.json(
            { error: 'Missing audio file.' },
            { status: 400 },
          )
        }

        return Response.json({ text: '你好' })
      },
    },
  },
})
