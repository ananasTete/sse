import { useChatStore } from './chat-store'
import { useShallow } from 'zustand/react/shallow'
import { selectCurrentBranchMessages, selectBranchChildUuids, getMessageByUuid } from '../state/chat-selectors'

export const useConversationMessages = (id: string) => {
  return useChatStore(useShallow(state => {
    const conv = state.conversations[id]
    return conv ? selectCurrentBranchMessages(conv) : []
  }))
}

export const useConversationStatus = (id: string) => {
  return useChatStore(state => state.conversations[id]?.status ?? 'ready')
}

export const useBranchState = (id: string, parentMessageUuid: string) => {
  return useChatStore(useShallow(state => {
    const conv = state.conversations[id]
    return conv ? selectBranchChildUuids(conv, parentMessageUuid) : []
  }))
}

export const useMessage = (id: string, messageUuid: string) => {
  return useChatStore(state => {
    const conv = state.conversations[id]
    return conv ? getMessageByUuid(conv, messageUuid) : null
  })
}
