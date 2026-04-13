export type StorageReadResult = Uint8Array | string | null
export type StorageWriteData = Uint8Array | string

export type StorageBackend = {
  read(path: string, signal?: AbortSignal): Promise<StorageReadResult>
  write(path: string, data: StorageWriteData, signal?: AbortSignal): Promise<void>
  append(path: string, data: StorageWriteData, signal?: AbortSignal): Promise<void>
  delete(path: string, signal?: AbortSignal): Promise<void>
  list(path: string, signal?: AbortSignal): Promise<string[]>
}

export type TranscriptStore = {
  appendSessionEvent(sessionId: string, event: StorageWriteData, signal?: AbortSignal): Promise<void>
  readSessionEvents(sessionId: string, signal?: AbortSignal): Promise<string[]>
}

export type SessionMetadataStore = {
  readSessionMetadata(sessionId: string, signal?: AbortSignal): Promise<Record<string, unknown> | null>
  writeSessionMetadata(
    sessionId: string,
    metadata: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void>
}

export type ArtifactStore = {
  writeArtifact(path: string, data: StorageWriteData, signal?: AbortSignal): Promise<void>
  readArtifact(path: string, signal?: AbortSignal): Promise<StorageReadResult>
}
