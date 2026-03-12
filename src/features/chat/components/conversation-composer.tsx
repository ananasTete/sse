import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { AVAILABLE_MODELS } from '#/features/chat/constants'

interface ConversationComposerProps {
  actions: ReactNode
  disabled?: boolean
  feedback?: string | null
  onInputChange: (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  overlay?: ReactNode
  placeholder?: string
  selectedModel: string
  setSelectedModel: (value: string) => void
  statusHint?: string | null
  textareaClassName?: string
  value: string
}

export function ConversationComposer({
  actions,
  disabled = false,
  feedback,
  onInputChange,
  onSubmit,
  overlay,
  placeholder = 'Type a message.',
  selectedModel,
  setSelectedModel,
  statusHint,
  textareaClassName,
  value,
}: ConversationComposerProps) {
  return (
    <div className="relative overflow-hidden border border-[var(--line)] bg-white/70 p-2 dark:bg-transparent">
      <form className="space-y-3" onSubmit={onSubmit}>
        <textarea
          className={`w-full resize-none border border-transparent bg-transparent px-3 py-2 text-[0.95rem] leading-7 text-[var(--sea-ink)] outline-none placeholder:text-[var(--sea-ink-soft)] ${textareaClassName ?? 'min-h-24'}`}
          disabled={disabled}
          onChange={onInputChange}
          placeholder={placeholder}
          value={value}
        />

        <div className="flex flex-col gap-3 border-t border-[var(--line)] px-1 pt-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1.5">
              <span className="px-2 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--sea-ink-soft)]">
                Model
              </span>

              <Select
                disabled={disabled}
                onValueChange={setSelectedModel}
                value={selectedModel}
              >
                <SelectTrigger className="h-10 min-w-64 border-[var(--line)] bg-[var(--surface)] text-[var(--sea-ink)] shadow-none">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_MODELS.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {feedback ? (
              <div className="px-2 text-sm text-[rgb(153,27,27)]">{feedback}</div>
            ) : statusHint ? (
              <div className="px-2 text-sm text-[var(--sea-ink-soft)]">
                {statusHint}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            {actions}
          </div>
        </div>
      </form>

      {overlay}
    </div>
  )
}
