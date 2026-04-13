/**
 * Pure utility functions inlined into the memory package to avoid importing
 * from @claude-code/app-compat. All functions here are stateless and have no
 * external dependencies beyond node built-ins.
 *
 * V7 §8 — memory is a Wave 2 leaf. This file replaces direct imports of:
 *   - isEnvTruthy / isEnvDefinedFalsy (envUtils.ts)
 *   - sanitizePath (sessionStoragePortable.ts)
 *   - formatFileSize (format.ts)
 *   - errorMessage (errors.ts)
 *   - count / uniq (array.ts)
 *   - sleep (sleep.ts)
 *   - getRetryDelay (services/api/withRetry.ts)
 *   - jsonStringify / jsonParse (slowOperations.ts)
 *   - classifyAxiosError (errors.ts)
 */

import { createHash } from 'crypto'

// ── Env utils ────────────────────────────────────────────────────────────────

export function isEnvTruthy(envVar: string | boolean | undefined): boolean {
  if (!envVar) return false
  if (typeof envVar === 'boolean') return envVar
  return ['1', 'true', 'yes', 'on'].includes(envVar.toLowerCase().trim())
}

export function isEnvDefinedFalsy(
  envVar: string | boolean | undefined,
): boolean {
  if (envVar === undefined) return false
  if (typeof envVar === 'boolean') return !envVar
  if (!envVar) return false
  return ['0', 'false', 'no', 'off'].includes(envVar.toLowerCase().trim())
}

// ── Path sanitizer ────────────────────────────────────────────────────────────

const MAX_SANITIZED_LENGTH = 200

function _simpleHash(str: string): string {
  // djb2 hash for Node.js fallback
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i)
    h = h >>> 0
  }
  return Math.abs(h).toString(36)
}

/**
 * Makes a string safe for use as a directory/file name.
 * Replaces all non-alphanumeric chars with hyphens.
 * For paths exceeding MAX_SANITIZED_LENGTH, appends a hash suffix.
 */
export function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized
  }
  const hash =
    typeof Bun !== 'undefined'
      ? Bun.hash(name).toString(36)
      : _simpleHash(name)
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${hash}`
}

// ── File size formatter ───────────────────────────────────────────────────────

export function formatFileSize(sizeInBytes: number): string {
  const kb = sizeInBytes / 1024
  if (kb < 1) return `${sizeInBytes} bytes`
  if (kb < 1024) return `${kb.toFixed(1).replace(/\.0$/, '')}KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1).replace(/\.0$/, '')}MB`
  const gb = mb / 1024
  return `${gb.toFixed(1).replace(/\.0$/, '')}GB`
}

// ── Error helpers ─────────────────────────────────────────────────────────────

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ── Array utils ───────────────────────────────────────────────────────────────

export function count<T>(arr: readonly T[], pred: (x: T) => unknown): number {
  let n = 0
  for (const x of arr) n += +!!pred(x)
  return n
}

export function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)]
}

// ── Sleep ─────────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── JSON utils ────────────────────────────────────────────────────────────────

export function jsonStringify(value: unknown): string {
  return JSON.stringify(value) ?? 'null'
}

export function jsonParse<T = unknown>(text: string): T {
  return JSON.parse(text) as T
}

// ── Retry delay ───────────────────────────────────────────────────────────────

const BASE_DELAY_MS = 1000

export function getRetryDelay(attempt: number, maxDelayMs = 32000): number {
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), maxDelayMs)
}

// ── Axios error classifier ────────────────────────────────────────────────────

type AxiosErrorKind = 'auth' | 'timeout' | 'network' | 'http' | 'other'

export function classifyAxiosError(error: unknown): {
  kind: AxiosErrorKind
  status: number | undefined
  message: string
} {
  if (
    error instanceof Error &&
    'isAxiosError' in error &&
    (error as { isAxiosError?: boolean }).isAxiosError
  ) {
    const axiosErr = error as {
      code?: string
      response?: { status?: number }
      message: string
    }
    const status = axiosErr.response?.status
    if (status === 401 || status === 403) {
      return { kind: 'auth', status, message: axiosErr.message }
    }
    if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT') {
      return { kind: 'timeout', status: undefined, message: axiosErr.message }
    }
    if (
      axiosErr.code === 'ECONNREFUSED' ||
      axiosErr.code === 'ENOTFOUND' ||
      axiosErr.code === 'ECONNRESET'
    ) {
      return { kind: 'network', status: undefined, message: axiosErr.message }
    }
    if (status !== undefined) {
      return { kind: 'http', status, message: axiosErr.message }
    }
    return { kind: 'other', status: undefined, message: axiosErr.message }
  }
  return {
    kind: 'other',
    status: undefined,
    message: error instanceof Error ? error.message : String(error),
  }
}

// ── Content hash ──────────────────────────────────────────────────────────────

export function sha256Hex(content: string): string {
  return 'sha256:' + createHash('sha256').update(content, 'utf8').digest('hex')
}
