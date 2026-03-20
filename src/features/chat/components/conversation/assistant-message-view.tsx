import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import type { UIMessage } from '../../../conversation/models/ui'
import { BranchNavigator } from './branch-navigator'
import { MessageContent } from '../message'

interface AssistantMessageViewProps {
  isBusy: boolean
  message: UIMessage
  onBranchSelect: (uuid: string) => void
  onRegenerate: (messageUuid: string) => void
}

export function AssistantMessageView({
  isBusy,
  message,
  onBranchSelect,
  onRegenerate,
}: AssistantMessageViewProps) {
  const [expandedToolBlocks, setExpandedToolBlocks] = useState<
    Record<string, boolean>
  >({})

  const handleToggleToolBlock = (toolUseId: string) => {
    setExpandedToolBlocks((current) => ({
      ...current,
      [toolUseId]: !(current[toolUseId] ?? false),
    }))
  }

  return (
    <div className="max-w-[min(42rem,92%)] border border-line bg-surface-strong px-4 py-3">
      <MessageContent
        blocks={message.content}
        expandedToolBlocks={expandedToolBlocks}
        isStreamingMessage={message.isStreaming}
        onToggleToolBlock={handleToggleToolBlock}
      />

      <div className="mt-3 flex items-center gap-3 border-t border-line pt-3 text-[0.72rem] text-sea-ink-soft">
        <button
          className="inline-flex items-center gap-1 transition hover:text-sea-ink disabled:cursor-not-allowed disabled:opacity-40"
          disabled={isBusy}
          onClick={() => {
            onRegenerate(message.uuid)
          }}
          type="button"
        >
          <RotateCcw className="size-3.5" />
          Regenerate
        </button>

        {message.branchInfo ? (
          <BranchNavigator
            branchInfo={message.branchInfo}
            disabled={isBusy}
            onSelect={onBranchSelect}
          />
        ) : null}
      </div>
    </div>
  )
}
