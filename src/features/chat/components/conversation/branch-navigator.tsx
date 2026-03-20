import { ChevronLeft, ChevronRight } from 'lucide-react'

interface BranchNavigatorProps {
  siblingUuids: string[]
  currentUuid: string
  disabled: boolean
  onSelect: (uuid: string) => void
}

export function BranchNavigator({
  siblingUuids,
  currentUuid,
  disabled,
  onSelect,
}: BranchNavigatorProps) {
  const index = siblingUuids.indexOf(currentUuid)
  const prev = index > 0 ? siblingUuids[index - 1] : null
  const next =
    index < siblingUuids.length - 1 ? siblingUuids[index + 1] : null

  return (
    <div className="inline-flex items-center gap-1">
      <button
        className="inline-flex size-5 items-center justify-center border border-transparent transition hover:border-line hover:text-sea-ink disabled:cursor-not-allowed disabled:opacity-35"
        disabled={!prev || disabled}
        onClick={() => {
          if (prev) {
            onSelect(prev)
          }
        }}
        type="button"
      >
        <ChevronLeft className="size-3.5" />
      </button>

      <span>
        {index + 1}/{siblingUuids.length}
      </span>

      <button
        className="inline-flex size-5 items-center justify-center border border-transparent transition hover:border-line hover:text-sea-ink disabled:cursor-not-allowed disabled:opacity-35"
        disabled={!next || disabled}
        onClick={() => {
          if (next) {
            onSelect(next)
          }
        }}
        type="button"
      >
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  )
}
