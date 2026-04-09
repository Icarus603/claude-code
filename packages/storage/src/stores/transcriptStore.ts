import { join } from 'path'
import type { StorageBackend, TranscriptStore } from '../contracts.js'

export class FileTranscriptStore implements TranscriptStore {
  constructor(
    private backend: StorageBackend,
    private sessionsDir: string,
  ) {}

  private sessionPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.jsonl`)
  }

  async appendSessionEvent(sessionId: string, event: string | Uint8Array): Promise<void> {
    await this.backend.append(this.sessionPath(sessionId), event)
  }

  async readSessionEvents(sessionId: string): Promise<string[]> {
    const data = await this.backend.read(this.sessionPath(sessionId))
    if (!data) {
      return []
    }
    const content = typeof data === 'string' ? data : Buffer.from(data).toString('utf8')
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  }
}
