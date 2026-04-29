import {
  appendFile as fsAppendFile,
  mkdir,
} from 'fs/promises'
import { dirname } from 'path'
import { jsonStringify } from '@claude-code/local-observability/slowOperations.js'
import type { Entry } from '@claude-code/agent/logsTypes.js'

/**
 * Per-file batched-append write queue used by sessionStorage's Project class.
 *
 * Three concerns rolled into one self-contained subsystem:
 *   1. Per-file queues — multiple sessions/sidechains in one process all
 *      append to different JSONL files; each gets its own queue so they
 *      don't block each other.
 *   2. Batched appends — coalesce up to MAX_CHUNK_BYTES of pending lines
 *      into a single fsAppendFile call to amortize syscall + fsync cost.
 *   3. Pending-write tracking — separate counter for non-queue tracked
 *      operations (e.g., removeMessageByUuid does positional writes that
 *      don't go through the queue but still need to be drained on flush).
 *
 * Was inlined in sessionStorage.ts as part of class Project; extracted
 * 2026-04-29 to shrink that god-class.
 */
export class SessionWriteQueue {
  private writeQueues = new Map<
    string,
    Array<{ entry: Entry; resolve: () => void }>
  >()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private activeDrain: Promise<void> | null = null
  private pendingWriteCount = 0
  private flushResolvers: Array<() => void> = []

  private flushIntervalMs = 100
  private readonly MAX_CHUNK_BYTES = 100 * 1024 * 1024

  /**
   * Switch to a faster flush interval. Used when remote-ingress (CCR) is
   * enabled — those callers want sub-100ms latency to the remote viewer.
   */
  setFlushIntervalMs(ms: number): void {
    this.flushIntervalMs = ms
  }

  /** @internal Reset all queue state for testing. */
  resetForTesting(): void {
    this.pendingWriteCount = 0
    this.flushResolvers = []
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    this.activeDrain = null
    this.writeQueues = new Map()
  }

  /**
   * Append `entry` to `filePath` as a single JSONL line. Multiple calls to
   * the same path coalesce into one fsAppendFile invocation. The returned
   * promise resolves when the bytes have actually hit disk (or as close as
   * the filesystem will admit — there's no fsync here).
   */
  enqueue(filePath: string, entry: Entry): Promise<void> {
    return new Promise<void>(resolve => {
      let queue = this.writeQueues.get(filePath)
      if (!queue) {
        queue = []
        this.writeQueues.set(filePath, queue)
      }
      queue.push({ entry, resolve })
      this.scheduleDrain()
    })
  }

  /**
   * Track a non-queue write operation (e.g., positional writes done by
   * removeMessageByUuid). The returned promise mirrors `fn`'s settlement;
   * the count is decremented in a finally so flush() can wait for it.
   */
  async trackWrite<T>(fn: () => Promise<T>): Promise<T> {
    this.pendingWriteCount++
    try {
      return await fn()
    } finally {
      this.pendingWriteCount--
      if (this.pendingWriteCount === 0) {
        for (const resolve of this.flushResolvers) {
          resolve()
        }
        this.flushResolvers = []
      }
    }
  }

  /**
   * Wait for all in-flight queued writes AND tracked non-queue writes to
   * complete. Cancels the flush timer if active so the wait is bounded by
   * actual drain time, not the timer interval.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.activeDrain) {
      await this.activeDrain
    }
    await this.drainWriteQueue()

    if (this.pendingWriteCount === 0) {
      return
    }
    return new Promise<void>(resolve => {
      this.flushResolvers.push(resolve)
    })
  }

  private scheduleDrain(): void {
    if (this.flushTimer) {
      return
    }
    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null
      this.activeDrain = this.drainWriteQueue()
      await this.activeDrain
      this.activeDrain = null
      // If more items arrived during drain, schedule again
      if (this.writeQueues.size > 0) {
        this.scheduleDrain()
      }
    }, this.flushIntervalMs)
  }

  private async appendToFile(filePath: string, data: string): Promise<void> {
    try {
      await fsAppendFile(filePath, data, { mode: 0o600 })
    } catch {
      // Directory may not exist — some NFS-like filesystems return
      // unexpected error codes, so don't discriminate on code.
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
      await fsAppendFile(filePath, data, { mode: 0o600 })
    }
  }

  private async drainWriteQueue(): Promise<void> {
    for (const [filePath, queue] of this.writeQueues) {
      if (queue.length === 0) {
        continue
      }
      const batch = queue.splice(0)

      let content = ''
      const resolvers: Array<() => void> = []

      for (const { entry, resolve } of batch) {
        const line = jsonStringify(entry) + '\n'

        if (content.length + line.length >= this.MAX_CHUNK_BYTES) {
          // Flush chunk and resolve its entries before starting a new one
          await this.appendToFile(filePath, content)
          for (const r of resolvers) {
            r()
          }
          resolvers.length = 0
          content = ''
        }

        content += line
        resolvers.push(resolve)
      }

      if (content.length > 0) {
        await this.appendToFile(filePath, content)
        for (const r of resolvers) {
          r()
        }
      }
    }

    // Clean up empty queues
    for (const [filePath, queue] of this.writeQueues) {
      if (queue.length === 0) {
        this.writeQueues.delete(filePath)
      }
    }
  }
}
