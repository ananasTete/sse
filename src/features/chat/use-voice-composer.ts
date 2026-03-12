import { useEffect, useRef, useState } from 'react'

const STT_TRANSCRIPTIONS_PATH = '/api/stt/transcriptions'

export type VoiceComposerStatus =
  | 'error'
  | 'idle'
  | 'speaking'
  | 'recording'
  | 'requesting_permission'
  | 'transcribing'
  | 'unsupported'

export interface UseVoiceComposerResult {
  canConfirm: boolean
  close: () => void
  confirm: () => Promise<string | null>
  errorMessage: string | null
  isOpen: boolean
  open: () => Promise<void>
  status: VoiceComposerStatus
  statusText: string
}

function getStatusText(status: VoiceComposerStatus) {
  switch (status) {
    case 'requesting_permission':
      return 'Waiting for microphone access'
    case 'recording':
      return 'Recording'
    case 'speaking':
      return 'Speaking'
    case 'transcribing':
      return 'Transcribing'
    case 'unsupported':
      return 'Voice input is not supported in this browser'
    case 'error':
      return 'Voice input failed'
    default:
      return 'Ready'
  }
}

export function useVoiceComposer(): UseVoiceComposerResult {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [status, setStatus] = useState<VoiceComposerStatus>('idle')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const sessionIdRef = useRef(0)
  const speakingTimeoutRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const transcriptionAbortControllerRef = useRef<AbortController | null>(null)
  const voiceChunksRef = useRef<Blob[]>([])

  const cleanupMedia = () => {
    const recorder = mediaRecorderRef.current

    if (recorder) {
      recorder.ondataavailable = null
    }

    mediaRecorderRef.current = null

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
    }

    if (animationFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (speakingTimeoutRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(speakingTimeoutRef.current)
      speakingTimeoutRef.current = null
    }

    analyserRef.current = null
    audioContextRef.current?.close().catch(() => {
      // Ignore audio context shutdown errors during cleanup.
    })
    audioContextRef.current = null
    streamRef.current = null
    voiceChunksRef.current = []
  }

  const dispose = () => {
    sessionIdRef.current += 1

    transcriptionAbortControllerRef.current?.abort()
    transcriptionAbortControllerRef.current = null

    const recorder = mediaRecorderRef.current

    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        // Ignore recorder stop errors while tearing down an abandoned session.
      }
    }

    cleanupMedia()
  }

  const close = () => {
    dispose()
    setErrorMessage(null)
    setIsOpen(false)
    setStatus('idle')
  }

  useEffect(() => dispose, [])

  // 开启录音
  const open = async () => {
    // 防止重复点击
    if (status === 'requesting_permission' || status === 'recording') {
      return
    }

    // 确认浏览器是否支持“拿麦克风流”和“录音”
    if (
      typeof window === 'undefined' ||
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setErrorMessage(null)
      setIsOpen(true)
      setStatus('unsupported')
      return
    }

    // 因为 getUserMedia() 是异步的，用户可能在权限弹窗期间点了关闭，或者重新开了一次。后面每当异
    // 步返回时，都会检查 sessionIdRef.current !== sessionId，见 use-voice-composer.ts:126。如果不一致，说明这次异步结果已经过期，必须丢弃，避免旧请求污染新状态。
    const sessionId = sessionIdRef.current + 1
    sessionIdRef.current = sessionId

    setErrorMessage(null)
    setIsOpen(true)
    setStatus('requesting_permission')
    voiceChunksRef.current = []

    try {
      // 请求麦克风权限，返回麦克风的实时音频流
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      if (sessionIdRef.current !== sessionId) {
        for (const track of stream.getTracks()) {
          track.stop()
        }

        return
      }

      // 负责把音频流录成 blob
      const recorder = new MediaRecorder(stream)
      
      // 负责分析实时音量
      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      const source = audioContext.createMediaStreamSource(stream)

      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.82
      source.connect(analyser)

      // 保存引用用于后续操作或者释放资源
      streamRef.current = stream
      mediaRecorderRef.current = recorder
      audioContextRef.current = audioContext
      analyserRef.current = analyser

      // 把 blob 块收集
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data)
        }
      }

      // 检测是否在说话
      const sampleBuffer = new Uint8Array(analyser.frequencyBinCount)
      const speakingThreshold = 10
      const speakingReleaseDelayMs = 240
      const updateSpeechActivity = () => {
        if (!analyserRef.current || sessionIdRef.current !== sessionId) {
          return
        }

        analyserRef.current.getByteTimeDomainData(sampleBuffer)

        let peakDistance = 0

        for (const sample of sampleBuffer) {
          const distance = Math.abs(sample - 128)

          if (distance > peakDistance) {
            peakDistance = distance
          }
        }

        if (peakDistance >= speakingThreshold) {
          if (speakingTimeoutRef.current !== null && typeof window !== 'undefined') {
            window.clearTimeout(speakingTimeoutRef.current)
            speakingTimeoutRef.current = null
          }

          setStatus((currentStatus) =>
            currentStatus === 'transcribing' ? currentStatus : 'speaking',
          )
        } else if (speakingTimeoutRef.current === null && typeof window !== 'undefined') {
          speakingTimeoutRef.current = window.setTimeout(() => {
            speakingTimeoutRef.current = null
            setStatus((currentStatus) =>
              currentStatus === 'speaking' ? 'recording' : currentStatus,
            )
          }, speakingReleaseDelayMs)
        }

        animationFrameRef.current = window.requestAnimationFrame(
          updateSpeechActivity,
        )
      }

      // 开始录音
      recorder.start()
      setStatus('recording')
      animationFrameRef.current = window.requestAnimationFrame(updateSpeechActivity)
    } catch (error) {
      if (sessionIdRef.current !== sessionId) {
        return
      }

      cleanupMedia()
      setStatus('error')
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to access the microphone.',
      )
    }
  }

  // 停止录音
  const stopRecording = async () => {
    const recorder = mediaRecorderRef.current

    if (!recorder) {
      throw new Error('No active recording session.')
    }

    // 避免重复 stop 时报错的兜底，'inactive' 表示已经停止了
    if (recorder.state === 'inactive') {
      const mimeType = recorder.mimeType || 'audio/webm'
      return new Blob(voiceChunksRef.current, { type: mimeType })
    }

    return await new Promise<Blob>((resolve, reject) => {
      const handleStop = () => {
        recorder.removeEventListener('error', handleError)
        // 把之前收集的 blob 块拼成最终音频文件
        const audioBlob = new Blob(voiceChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })

        cleanupMedia()
        resolve(audioBlob)
      }

      const handleError = () => {
        recorder.removeEventListener('stop', handleStop)
        cleanupMedia()
        reject(new Error('Recording failed.'))
      }

      recorder.addEventListener('stop', handleStop, { once: true })
      recorder.addEventListener('error', handleError, { once: true })

      // 触发停止录音，真正停止要在 stop 事件
      recorder.stop()
    })
  }

  const confirm = async () => {
    if (status !== 'recording' && status !== 'speaking') {
      return null
    }

    const sessionId = sessionIdRef.current
    setErrorMessage(null)
    setStatus('transcribing')

    try {
      const audioBlob = await stopRecording()
      const formData = new FormData()
      const abortController = new AbortController()

      transcriptionAbortControllerRef.current = abortController
      formData.append('file', audioBlob, 'voice-input.webm')

      const response = await fetch(STT_TRANSCRIPTIONS_PATH, {
        body: formData,
        method: 'POST',
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new Error('Transcription request failed.')
      }

      const data = (await response.json()) as { text?: string }

      if (sessionIdRef.current !== sessionId) {
        return null
      }

      transcriptionAbortControllerRef.current = null
      close()
      return typeof data.text === 'string' ? data.text : null
    } catch (error) {
      transcriptionAbortControllerRef.current = null

      if (sessionIdRef.current !== sessionId) {
        return null
      }

      if (error instanceof Error && error.name === 'AbortError') {
        return null
      }

      setStatus('error')
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to transcribe audio.',
      )
      return null
    }
  }

  return {
    canConfirm: status === 'recording' || status === 'speaking',
    close,
    confirm,
    errorMessage,
    isOpen,
    open,
    status,
    statusText: getStatusText(status),
  }
}
