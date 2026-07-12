import axios from 'axios'
import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { chmod, rm } from 'fs/promises'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { sleep } from '@claude-code/config/sleep'
import { logForDebugging } from '@claude-code/local-observability/debug.js'

const MAX_DOWNLOAD_RETRIES = 3
const TRANSIENT_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ERR_NETWORK',
])

export async function streamBinaryDownload({
  binaryUrl,
  expectedChecksum,
  binaryPath,
  requestConfig,
  skipChecksum,
  stallTimeoutMs,
}: {
  binaryUrl: string
  expectedChecksum: string
  binaryPath: string
  requestConfig: Record<string, unknown>
  skipChecksum: boolean
  stallTimeoutMs: number
}): Promise<void> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
    const controller = new AbortController()
    let stalled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const resetTimer = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        stalled = true
        controller.abort()
      }, stallTimeoutMs)
    }

    try {
      resetTimer()
      const response = await axios.get(binaryUrl, {
        timeout: 5 * 60_000,
        responseType: 'stream',
        signal: controller.signal,
        ...requestConfig,
      })
      const hash = createHash('sha256')
      const hashingStream = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          resetTimer()
          hash.update(chunk)
          callback(null, chunk)
        },
      })
      await pipeline(
        response.data,
        hashingStream,
        createWriteStream(binaryPath, { mode: 0o755 }),
      )
      if (timer) clearTimeout(timer)
      const actualChecksum = hash.digest('hex')
      if (!skipChecksum && actualChecksum !== expectedChecksum) {
        throw new Error(
          `Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`,
        )
      }
      await chmod(binaryPath, 0o755)
      return
    } catch (cause) {
      if (timer) clearTimeout(timer)
      await rm(binaryPath, { force: true }).catch(() => {})
      const code = (cause as { code?: string }).code
      lastError = stalled
        ? new Error('Download stalled: no data received before timeout')
        : cause instanceof Error
          ? cause
          : new Error(String(cause))
      const transient =
        stalled || axios.isCancel(cause) || (code ? TRANSIENT_CODES.has(code) : false)
      if (!transient || attempt === MAX_DOWNLOAD_RETRIES) throw lastError
      logForDebugging(
        `Download interrupted on attempt ${attempt}/${MAX_DOWNLOAD_RETRIES}; retrying`,
      )
      await sleep(500 * 2 ** (attempt - 1))
    }
  }
  throw lastError ?? new Error('Download failed')
}
