import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { BranchInfo } from '../../../conversation/models/ui'

interface BranchNavigatorProps {
  branchInfo: BranchInfo
  disabled: boolean
  onSelect: (uuid: string) => void
}

export function BranchNavigator({
  branchInfo,
  disabled,
  onSelect,
}: BranchNavigatorProps) {
  const { branchCount, branchIndex, nextBranchUuid, previousBranchUuid } =
    branchInfo

  if (branchCount <= 1) {
    return null
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        className="inline-flex size-5 items-center justify-center border border-transparent transition hover:border-line hover:text-sea-ink disabled:cursor-not-allowed disabled:opacity-35"
        disabled={!previousBranchUuid || disabled}
        onClick={() => {
          if (previousBranchUuid) {
            onSelect(previousBranchUuid)
          }
        }}
        type="button"
      >
        <ChevronLeft className="size-3.5" />
      </button>

      <span>
        {branchIndex + 1}/{branchCount}
      </span>

      <button
        className="inline-flex size-5 items-center justify-center border border-transparent transition hover:border-line hover:text-sea-ink disabled:cursor-not-allowed disabled:opacity-35"
        disabled={!nextBranchUuid || disabled}
        onClick={() => {
          if (nextBranchUuid) {
            onSelect(nextBranchUuid)
          }
        }}
        type="button"
      >
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  )
}
