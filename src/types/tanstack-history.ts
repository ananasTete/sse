import type { ChatConversationRouteState } from '#/features/chat/models'

declare module '@tanstack/history' {
  interface HistoryState extends ChatConversationRouteState {}
}

export {}
