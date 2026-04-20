// Canonical shared error helpers. Zero dependencies besides the Anthropic SDK.
// `src/utils/errors.ts` re-exports from here so existing callers continue to work;
// packages/* must import from this path to stay inside V7 §11.2.

import { APIUserAbortError } from '@anthropic-ai/sdk'

export class ClaudeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

export class MalformedCommandError extends Error {}

export class AbortError extends Error {
  constructor(message?: string) {
    super(message)
    this.name = 'AbortError'
  }
}

/**
 * True iff `e` is any of the abort-shaped errors the codebase encounters:
 * our AbortError class, a DOMException from AbortController.abort()
 * (.name === 'AbortError'), or the SDK's APIUserAbortError. The SDK class
 * is checked via instanceof because minified builds mangle class names —
 * constructor.name becomes something like 'nJT' and the SDK never sets
 * this.name, so string matching silently fails in production.
 */
export function isAbortError(e: unknown): boolean {
  return (
    e instanceof AbortError ||
    e instanceof APIUserAbortError ||
    (e instanceof Error && e.name === 'AbortError')
  )
}

/**
 * Custom error class for configuration file parsing errors
 * Includes the file path and the default configuration that should be used
 */
export class ConfigParseError extends Error {
  filePath: string
  defaultConfig: unknown

  constructor(message: string, filePath: string, defaultConfig: unknown) {
    super(message)
    this.name = 'ConfigParseError'
    this.filePath = filePath
    this.defaultConfig = defaultConfig
  }
}

export class ShellError extends Error {
  constructor(
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly code: number,
    public readonly interrupted: boolean,
  ) {
    super('Shell command failed')
    this.name = 'ShellError'
  }
}

export class TeleportOperationError extends Error {
  constructor(
    message: string,
    public readonly formattedMessage: string,
  ) {
    super(message)
    this.name = 'TeleportOperationError'
  }
}

/**
 * Error with a message that is safe to log to telemetry.
 * Use the long name to confirm you've verified the message contains no
 * sensitive data (file paths, URLs, code snippets).
 */
export class TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS extends Error {
  readonly telemetryMessage: string

  constructor(message: string, telemetryMessage?: string) {
    super(message)
    this.name = 'TelemetrySafeError'
    this.telemetryMessage = telemetryMessage ?? message
  }
}

export function hasExactErrorMessage(error: unknown, message: string): boolean {
  return error instanceof Error && error.message === message
}

/**
 * Normalize an unknown value into an Error.
 */
export function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

/**
 * Extract a string message from an unknown error-like value.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Extract the errno code (e.g., 'ENOENT', 'EACCES') from a caught error.
 */
export function getErrnoCode(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'code' in e && typeof e.code === 'string') {
    return e.code
  }
  return undefined
}

/**
 * True if the error is ENOENT (file or directory does not exist).
 */
export function isENOENT(e: unknown): boolean {
  return getErrnoCode(e) === 'ENOENT'
}

/**
 * Extract the errno path (the filesystem path that triggered the error)
 * from a caught error. Returns undefined if the error has no path.
 */
export function getErrnoPath(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'path' in e && typeof e.path === 'string') {
    return e.path
  }
  return undefined
}

/**
 * Extract error message + top N stack frames from an unknown error.
 */
export function shortErrorStack(e: unknown, maxFrames = 5): string {
  if (!(e instanceof Error)) return String(e)
  if (!e.stack) return e.message
  const lines = e.stack.split('\n')
  const header = lines[0] ?? e.message
  const frames = lines.slice(1).filter(l => l.trim().startsWith('at '))
  if (frames.length <= maxFrames) return e.stack
  return [header, ...frames.slice(0, maxFrames)].join('\n')
}

/**
 * True if the error means the path is missing, inaccessible, or
 * structurally unreachable.
 */
export function isFsInaccessible(e: unknown): e is NodeJS.ErrnoException {
  const code = getErrnoCode(e)
  return (
    code === 'ENOENT' ||
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'ENOTDIR' ||
    code === 'ELOOP'
  )
}

export type AxiosErrorKind =
  | 'auth' // 401/403 — caller typically sets skipRetry
  | 'timeout' // ECONNABORTED
  | 'network' // ECONNREFUSED/ENOTFOUND
  | 'http' // other axios error (may have status)
  | 'other' // not an axios error

/**
 * Classify a caught error from an axios request into one of a few buckets.
 */
export function classifyAxiosError(e: unknown): {
  kind: AxiosErrorKind
  status?: number
  message: string
} {
  const message = errorMessage(e)
  if (
    !e ||
    typeof e !== 'object' ||
    !('isAxiosError' in e) ||
    !e.isAxiosError
  ) {
    return { kind: 'other', message }
  }
  const err = e as {
    response?: { status?: number }
    code?: string
  }
  const status = err.response?.status
  if (status === 401 || status === 403) return { kind: 'auth', status, message }
  if (err.code === 'ECONNABORTED') return { kind: 'timeout', status, message }
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    return { kind: 'network', status, message }
  }
  return { kind: 'http', status, message }
}
