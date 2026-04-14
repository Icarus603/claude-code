export type VoiceState = 'idle' | 'recording' | 'processing'

export type VoiceTranscriptChunk = {
  text: string
  isFinal: boolean
}

export type VoiceRuntime = {
  state: VoiceState
  start(signal?: AbortSignal): Promise<void>
  stop(signal?: AbortSignal): Promise<void>
  pushTranscript(chunk: VoiceTranscriptChunk): void
}
