import type {
  VoiceRuntime,
  VoiceTranscriptChunk,
} from '../src/contracts.js'

export function createNullVoiceRuntime(): VoiceRuntime {
  return {
    state: 'idle',
    async start() {},
    async stop() {},
    pushTranscript(_chunk: VoiceTranscriptChunk) {},
  }
}

export function createScriptedVoiceChunks(
  texts: string[],
): VoiceTranscriptChunk[] {
  return texts.map((text, index) => ({
    text,
    isFinal: index === texts.length - 1,
  }))
}
