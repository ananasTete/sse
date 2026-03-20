import type { ChatMessage } from './message'

export interface BranchInfo {
  branchIndex: number
  branchCount: number
  previousBranchUuid: string | null
  nextBranchUuid: string | null
}

export type UIMessage = ChatMessage & {
  branchInfo: BranchInfo | null
  isStreaming: boolean
}
