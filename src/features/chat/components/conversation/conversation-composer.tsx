import { ArrowUp, Check, Mic, Square, X } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '../../models/constants'
import { useVoiceComposer } from '../../hooks/use-voice-composer'
import { cn } from '#/lib/utils'

interface ConversationComposerPanel {
  isPending: boolean
  onStop: () => void
  onSubmit: (payload: { model: string; prompt: string }) => void | Promise<void>
}

export function ConversationComposer({
  isPending,
  onStop,
  onSubmit,
}: ConversationComposerPanel) {
  const [input, setInput] = useState('')
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL)
  const {
    canConfirm,
    close: closeVoiceComposer,
    confirm: confirmVoiceComposer,
    errorMessage: voiceComposerErrorMessage,
    isOpen: isVoiceComposerOpen,
    open: openVoiceComposer,
    status: voiceComposerStatus,
    statusText: voiceComposerStatusText,
  } = useVoiceComposer()

  const isMicDisabled = isPending || isVoiceComposerOpen

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const prompt = input.trim()
    if (!prompt) return
    await onSubmit({ model: selectedModel, prompt })
    setInput('')
  }

  const handleConfirmVoiceComposer = async () => {
    const text = await confirmVoiceComposer()
    if (!text?.trim()) return
    setInput((current) =>
      current
        ? `${current}${current.endsWith('\n') ? '' : '\n'}${text.trim()}`
        : text.trim(),
    )
  }

  return (
    <div className="relative overflow-hidden border border-[var(--line)] bg-white/70 p-2 dark:bg-transparent">
      <form className="space-y-3" onSubmit={handleSubmit}>
        <textarea
          className="min-h-24 w-full resize-none border border-transparent bg-transparent px-3 py-2 text-[0.95rem] leading-7 text-[var(--sea-ink)] outline-none placeholder:text-[var(--sea-ink-soft)]"
          disabled={isVoiceComposerOpen}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message."
          value={input}
        />

        <div className="flex flex-col gap-3 border-t border-[var(--line)] px-1 pt-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <span className="px-2 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--sea-ink-soft)]">
              Model
            </span>

            <Select
              disabled={isVoiceComposerOpen}
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

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              className="inline-flex h-10 items-center justify-center border border-[var(--sea-ink)] bg-[var(--sea-ink)] px-4 text-sm font-medium text-[var(--foam)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={isVoiceComposerOpen}
              onClick={isPending ? onStop : undefined}
              type={isPending ? 'button' : 'submit'}
            >
              {isPending ? (
                <>
                  <Square className="mr-2 size-4 fill-current" />
                  Stop
                </>
              ) : (
                <>
                  <ArrowUp className="mr-2 size-4" />
                  Send
                </>
              )}
            </button>

            <button
              aria-label="Record voice input"
              className="inline-flex h-10 w-10 items-center justify-center border border-[var(--line)] bg-[var(--surface)] text-[var(--sea-ink)] transition hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={isMicDisabled}
              onClick={() => void openVoiceComposer()}
              type="button"
            >
              <Mic className="size-4" />
            </button>
          </div>
        </div>
      </form>

      {isVoiceComposerOpen ? (
        <div className="absolute inset-0 z-10 flex flex-col justify-between bg-[rgba(246,245,240,0.96)] px-5 py-4 backdrop-blur-sm">
          <div className="flex flex-1 items-center justify-center">
            {voiceComposerStatus === 'speaking' ? (
              <div className="flex max-w-sm flex-col items-center gap-5 text-center">
                <div className="relative flex h-28 w-28 items-center justify-center">
                  <div className="absolute h-28 w-28 animate-ping rounded-full bg-[rgba(47,106,74,0.1)]" />
                  <div className="absolute h-20 w-20 rounded-full border border-[rgba(47,106,74,0.28)] bg-[rgba(47,106,74,0.12)]" />
                  <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-[var(--sea-ink)] bg-[var(--sea-ink)] text-[var(--foam)] shadow-[0_12px_30px_rgba(23,58,64,0.24)]">
                    <Mic className="size-5" />
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-base font-semibold uppercase tracking-[0.18em] text-[var(--sea-ink)]">
                    {voiceComposerStatusText}
                  </p>
                  <p className="text-sm leading-6 text-[var(--sea-ink-soft)]">
                    Voice activity detected. Finish the take, then confirm to
                    send it for transcription.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex max-w-sm flex-col items-center gap-4 text-center">
                <div
                  className={cn(
                    'flex h-14 w-14 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--sea-ink)]',
                    voiceComposerStatus === 'recording' ? 'animate-pulse' : '',
                  )}
                >
                  <Mic className="size-5" />
                </div>

                <div className="space-y-2">
                  <p className="text-base font-semibold text-[var(--sea-ink)]">
                    {voiceComposerStatusText}
                  </p>
                  <p className="text-sm leading-6 text-[var(--sea-ink-soft)]">
                    {voiceComposerErrorMessage
                      ? voiceComposerErrorMessage
                      : voiceComposerStatus === 'recording'
                        ? 'Listening for speech. Keyboard input stays locked until this take is closed or confirmed.'
                        : 'The composer is temporarily reserved for voice capture.'}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              aria-label="Close voice input"
              className="inline-flex h-11 w-11 items-center justify-center border border-[var(--line)] bg-[var(--surface)] text-[var(--sea-ink)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
              onClick={closeVoiceComposer}
              type="button"
            >
              <X className="size-4" />
            </button>

            <button
              aria-label="Confirm voice input"
              className="inline-flex h-11 w-11 items-center justify-center border border-[var(--sea-ink)] bg-[var(--sea-ink)] text-[var(--foam)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canConfirm}
              onClick={() => void handleConfirmVoiceComposer()}
              type="button"
            >
              <Check className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
