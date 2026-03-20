import { Check, Pencil, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChatContent } from '../../../conversation/models/message'
import type { UIMessage } from '../../../conversation/models/ui'
import { BranchNavigator } from './branch-navigator'

function getFirstTextContent(content: ChatContent[]): string {
  const block = content.find((b): b is Extract<ChatContent, { type: 'text' }> => b.type === 'text')
  return block?.text ?? ''
}

interface UserMessageViewProps {
  isBusy: boolean
  message: UIMessage
  onBranchSelect: (uuid: string) => void
  onConfirmEdit: (message: UIMessage, prompt: string) => void
  onRegenerate: (messageUuid: string) => void
}

export function UserMessageView({
  isBusy,
  message,
  onBranchSelect,
  onConfirmEdit,
  onRegenerate,
}: UserMessageViewProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Reset editing state if the message is removed from the tree (e.g. branch switch)
  useEffect(() => {
    if (!isEditing) {
      return
    }

    return () => {
      setIsEditing(false)
      setEditingPrompt('')
    }
  }, [isEditing, message.uuid])

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing) {
      textareaRef.current?.focus()
    }
  }, [isEditing])

  const handleStartEdit = () => {
    setIsEditing(true)
    setEditingPrompt(getFirstTextContent(message.content))
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditingPrompt('')
  }

  const handleConfirmEdit = () => {
    onConfirmEdit(message, editingPrompt)
    setIsEditing(false)
    setEditingPrompt('')
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancelEdit()
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (editingPrompt.trim()) {
        handleConfirmEdit()
      }
    }
  }

  return (
    <div
      className={
        isEditing
          ? 'w-full border border-line bg-user-bubble-bg px-4 py-3'
          : 'max-w-[min(42rem,92%)] border border-line bg-user-bubble-bg px-4 py-3'
      }
    >
      {isEditing ? (
        <div>
          <textarea
            ref={textareaRef}
            className="min-h-28 w-full resize-y border border-line bg-surface px-3 py-2 text-[0.95rem] leading-7 text-sea-ink outline-none"
            onChange={(event) => {
              setEditingPrompt(event.target.value)
            }}
            onKeyDown={handleKeyDown}
            value={editingPrompt}
          />
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-[0.95rem] leading-7 text-sea-ink">
          {getFirstTextContent(message.content)}
        </p>
      )}

      <div className="mt-3 flex items-center gap-3 border-t border-line pt-3 text-[0.72rem] text-sea-ink-soft">
        {isEditing ? (
          <>
            <button
              className="inline-flex items-center gap-1 transition hover:text-sea-ink disabled:cursor-not-allowed disabled:opacity-40"
              disabled={isBusy}
              onClick={handleCancelEdit}
              type="button"
            >
              <X className="size-3.5" />
              Cancel
            </button>

            <button
              className="inline-flex items-center gap-1 transition hover:text-sea-ink disabled:cursor-not-allowed disabled:opacity-40"
              disabled={isBusy || !editingPrompt.trim()}
              onClick={handleConfirmEdit}
              type="button"
            >
              <Check className="size-3.5" />
              Confirm
            </button>
          </>
        ) : (
          <>
            <button
              className="inline-flex items-center gap-1 transition hover:text-sea-ink disabled:cursor-not-allowed disabled:opacity-40"
              disabled={isBusy}
              onClick={handleStartEdit}
              type="button"
            >
              <Pencil className="size-3.5" />
              Edit
            </button>

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
          </>
        )}

        {message.branchInfo ? (
          <BranchNavigator
            branchInfo={message.branchInfo}
            disabled={isBusy || isEditing}
            onSelect={onBranchSelect}
          />
        ) : null}
      </div>
    </div>
  )
}
