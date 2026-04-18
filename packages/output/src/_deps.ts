/**
 * @claude-code/output/_deps
 *
 * V7 §3.2 ports-and-adapters — setter-based dependency injection boundary.
 * Wave-2 platform-foundation package; depends only on local-observability
 * + config in pure form. Anything host-specific (session id, cwd, cleanup
 * registry, debug logger, error logger, intl formatters) is injected.
 *
 * Rule: no imports from `src/*` or any other @claude-code/* package here.
 */

// ---------------------------------------------------------------------------
// Session state (used by asciicast for trace-file naming)
// ---------------------------------------------------------------------------

let _getSessionId: () => string = () => 'unknown-session'
let _getOriginalCwd: () => string = () => process.cwd()

export function getSessionId(): string {
  return _getSessionId()
}

export function getOriginalCwd(): string {
  return _getOriginalCwd()
}

export function setGetSessionIdFn(fn: () => string): void {
  _getSessionId = fn
}

export function setGetOriginalCwdFn(fn: () => string): void {
  _getOriginalCwd = fn
}

// ---------------------------------------------------------------------------
// Cleanup registry (used by asciicast + bufferedWriter to flush on exit)
// ---------------------------------------------------------------------------

let _registerCleanup: (fn: () => void | Promise<void>) => void = () => {}

export function registerCleanup(fn: () => void | Promise<void>): void {
  _registerCleanup(fn)
}

export function setRegisterCleanupFn(
  fn: (cb: () => void | Promise<void>) => void,
): void {
  _registerCleanup = fn
}

// ---------------------------------------------------------------------------
// Debug + error logging (re-injected rather than crossing into
// local-observability directly because output is itself a dependency of
// observability sinks; avoids cyclic import at bootstrap time).
// ---------------------------------------------------------------------------

let _logForDebugging: (message: string, ...args: unknown[]) => void = () => {}
let _logError: (error: unknown) => void = () => {}

export function logForDebugging(message: string, ...args: unknown[]): void {
  _logForDebugging(message, ...args)
}

export function logError(error: unknown): void {
  _logError(error)
}

export function setLogForDebuggingFn(
  fn: (message: string, ...args: unknown[]) => void,
): void {
  _logForDebugging = fn
}

export function setLogErrorFn(fn: (error: unknown) => void): void {
  _logError = fn
}

// ---------------------------------------------------------------------------
// Intl formatters (used by format.ts for human-readable times / zones)
// ---------------------------------------------------------------------------

let _getRelativeTimeFormat: (
  style: 'long' | 'short' | 'narrow',
  numeric: 'always' | 'auto',
) => Intl.RelativeTimeFormat = (style, numeric) =>
  new Intl.RelativeTimeFormat(undefined, { style, numeric })

let _getTimeZone: () => string = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone

export function getRelativeTimeFormat(
  style: 'long' | 'short' | 'narrow',
  numeric: 'always' | 'auto',
): Intl.RelativeTimeFormat {
  return _getRelativeTimeFormat(style, numeric)
}

export function getTimeZone(): string {
  return _getTimeZone()
}

export function setGetRelativeTimeFormatFn(
  fn: (
    style: 'long' | 'short' | 'narrow',
    numeric: 'always' | 'auto',
  ) => Intl.RelativeTimeFormat,
): void {
  _getRelativeTimeFormat = fn
}

export function setGetTimeZoneFn(fn: () => string): void {
  _getTimeZone = fn
}

// ---------------------------------------------------------------------------
// Inlined pure helpers (small, frozen, duplication > setter overhead)
// ---------------------------------------------------------------------------

/**
 * `isEnvTruthy` — duplicated from @claude-code/config/env/utils.
 * Used by renderOptions.ts for simple env-var gates.
 */
export function isEnvTruthy(value: string | boolean | undefined): boolean {
  if (!value) return false
  if (typeof value === 'boolean') return value
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase().trim())
}

/**
 * `escapeXml` — duplicated from src/utils/xml.ts (16 lines total).
 * Used by ansiToSvg.ts for SVG text escaping.
 */
export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * `jsonStringify` — trivial wrapper. Override via setter if the host
 * has a cycle-safe variant.
 */
let _jsonStringify: (value: unknown) => string = v => JSON.stringify(v)

export function jsonStringify(value: unknown): string {
  return _jsonStringify(value)
}

export function setJsonStringifyFn(fn: (value: unknown) => string): void {
  _jsonStringify = fn
}

// ---------------------------------------------------------------------------
// Path sanitization + fs impl (used by asciicast for trace file writes)
// ---------------------------------------------------------------------------

let _sanitizePath: (path: string) => string = p => p

export function sanitizePath(path: string): string {
  return _sanitizePath(path)
}

export function setSanitizePathFn(fn: (path: string) => string): void {
  _sanitizePath = fn
}

export type OutputFsImpl = {
  existsSync(path: string): boolean
  mkdirSync(path: string, options?: { recursive?: boolean }): void
  writeFileSync(path: string, data: string): void
  readFileSync(path: string, encoding: 'utf8'): string
  appendFileSync(path: string, data: string): void
}

let _fs: OutputFsImpl | null = null

function nodeFsFallback(): OutputFsImpl {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  return {
    existsSync: p => fs.existsSync(p),
    mkdirSync: (p, o) => fs.mkdirSync(p, { recursive: true, ...(o ?? {}) }),
    writeFileSync: (p, d) => fs.writeFileSync(p, d),
    readFileSync: (p, e) => fs.readFileSync(p, e),
    appendFileSync: (p, d) => fs.appendFileSync(p, d),
  }
}

export function getFsImplementation(): OutputFsImpl {
  if (!_fs) _fs = nodeFsFallback()
  return _fs
}

export function setFsImplementationFn(fs: OutputFsImpl): void {
  _fs = fs
}

// ---------------------------------------------------------------------------
// Claude config home dir (re-injected rather than imported from config to
// avoid creating a config→output→config cycle through config's env module).
// ---------------------------------------------------------------------------

let _getClaudeConfigHomeDir: () => string = () => {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.'
  return `${home}/.claude`
}

export function getClaudeConfigHomeDir(): string {
  return _getClaudeConfigHomeDir()
}

export function setGetClaudeConfigHomeDirFn(fn: () => string): void {
  _getClaudeConfigHomeDir = fn
}
