// V7 §8.20 — voice integration public surface.
export * from './contracts.js'
export * from './errors.js'

import type { VoiceRuntime, VoiceTranscriptChunk } from './contracts.js'

export function createVoiceRuntime(): VoiceRuntime {
  let state: VoiceRuntime['state'] = 'idle'
  const chunks: VoiceTranscriptChunk[] = []
  return {
    get state() {
      return state
    },
    async start(_signal?: AbortSignal) {
      state = 'recording'
    },
    async stop(_signal?: AbortSignal) {
      state = 'idle'
    },
    pushTranscript(chunk: VoiceTranscriptChunk) {
      chunks.push(chunk)
      state = chunk.isFinal ? 'idle' : 'processing'
    },
  }
}
