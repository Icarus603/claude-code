export type StorageReadResult = Uint8Array | string | null
export type StorageWriteData = Uint8Array | string

export type StorageBackend = {
  read(path: string): Promise<StorageReadResult>
  write(path: string, data: StorageWriteData): Promise<void>
  append(path: string, data: StorageWriteData): Promise<void>
  delete(path: string): Promise<void>
  list(path: string): Promise<string[]>
}

export type TranscriptStore = {
  appendSessionEvent(sessionId: string, event: StorageWriteData): Promise<void>
  readSessionEvents(sessionId: string): Promise<string[]>
}

export type SessionMetadataStore = {
  readSessionMetadata(sessionId: string): Promise<Record<string, unknown> | null>
  writeSessionMetadata(
    sessionId: string,
    metadata: Record<string, unknown>,
  ): Promise<void>
}

export type ArtifactStore = {
  writeArtifact(path: string, data: StorageWriteData): Promise<void>
  readArtifact(path: string): Promise<StorageReadResult>
}
