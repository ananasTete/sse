export const ROOT_PARENT_MESSAGE_UUID = '00000000-0000-4000-8000-000000000000'

export const DEFAULT_CONVERSATION_ID =
  '12e76900-eac7-488e-928b-d244016431a9'

export const DEFAULT_MODEL = 'claude-sonnet-4-6'

export const AVAILABLE_MODELS = [
  {
    label: 'Claude Sonnet 4.6',
    value: 'claude-sonnet-4-6',
  },
  {
    label: 'GPT-4.1',
    value: 'gpt-4.1',
  },
  {
    label: 'Gemini 2.0 Flash',
    value: 'gemini-2.0-flash',
  },
] as const

export const CHAT_COMPLETION_PATH = `/api/chat_conversations/${DEFAULT_CONVERSATION_ID}/completion`
