import { join } from 'path'
import type { SessionMetadataStore, StorageBackend } from '../contracts.js'

export class FileSessionMetadataStore implements SessionMetadataStore {
  constructor(
    private backend: StorageBackend,
    private metadataDir: string,
  ) {}

  private metadataPath(sessionId: string): string {
    return join(this.metadataDir, `${sessionId}.metadata.json`)
  }

  async readSessionMetadata(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | null> {
    const data = await this.backend.read(this.metadataPath(sessionId), signal)
    if (!data) {
      return null
    }
    const content = typeof data === 'string' ? data : Buffer.from(data).toString('utf8')
    try {
      const parsed = JSON.parse(content)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }

  async writeSessionMetadata(
    sessionId: string,
    metadata: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.backend.write(
      this.metadataPath(sessionId),
      JSON.stringify(metadata, null, 2),
      signal,
    )
  }
}
