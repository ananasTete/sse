import type { PendingInitialConversationSubmission } from './conversation-model'

const pendingSubmissions = new Map<string, PendingInitialConversationSubmission>()

export function consumePendingInitialSubmission(conversationId: string) {
  const submission = pendingSubmissions.get(conversationId) ?? null

  pendingSubmissions.delete(conversationId)

  return submission
}

export function setPendingInitialSubmission(
  conversationId: string,
  submission: PendingInitialConversationSubmission,
) {
  pendingSubmissions.set(conversationId, submission)
}
