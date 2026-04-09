import type { ArtifactStore, StorageBackend, StorageReadResult, StorageWriteData } from '../contracts.js'

export class BackendArtifactStore implements ArtifactStore {
  constructor(private backend: StorageBackend) {}

  async writeArtifact(path: string, data: StorageWriteData): Promise<void> {
    await this.backend.write(path, data)
  }

  async readArtifact(path: string): Promise<StorageReadResult> {
    return this.backend.read(path)
  }
}
