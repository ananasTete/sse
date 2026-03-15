import { formatSseEvent, toChatTimestamp } from '../../utils'
import {
  mutateConversation,
  updateConversationSummaryFields,
} from '../mock-conversation-store'
import { publishEvent, isAborted } from './event-bus'
import type {
  ChatCompletionRequest,
  ChatCitation,
} from '../../models/chat'
import type { ChatConversationDetail } from '../../models/conversation'
import type { MockReplySegment } from '../../../../../src/routes/api/chat_conversations/$conversationId/completion.tsx'

// We will pass the necessary functions and context to this worker
export async function runGenerationWorker({
  conversationId,
  assistantMessageUuid,
  toolUseId,
  replySegments,
  searchResults,
  callbacks,
}: {
  conversationId: string
  assistantMessageUuid: string
  toolUseId: string
  replySegments: any[]
  searchResults: any[]
  callbacks: any
}) {
  // Logic from completion.tsx ReadableStream.start()
}
