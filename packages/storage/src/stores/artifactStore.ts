import type { ArtifactStore, StorageBackend, StorageReadResult, StorageWriteData } from '../contracts.js'

export class BackendArtifactStore implements ArtifactStore {
  constructor(private backend: StorageBackend) {}

  async writeArtifact(path: string, data: StorageWriteData, signal?: AbortSignal): Promise<void> {
    await this.backend.write(path, data, signal)
  }

  async readArtifact(path: string, signal?: AbortSignal): Promise<StorageReadResult> {
    return this.backend.read(path, signal)
  }
}
