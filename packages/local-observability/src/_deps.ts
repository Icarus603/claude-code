/**
 * @claude-code/local-observability/_deps
 *
 * V7 §3.2 ports-and-adapters — setter-based dependency injection boundary.
 *
 * local-observability is the bottom Wave-1 leaf; V7 §8.12 mandates
 * "無或僅最小 utility-only deps". When a moved module needs app-level
 * state (session id, cache paths, filesystem implementation), the host
 * composition root injects that implementation via the setters below.
 *
 * Each dependency has a safe default that works for a minimal subset of
 * use cases (in tests, or before installHostBindings runs). Host code in
 * `src/runtime/bootstrap.ts` calls the corresponding `setXxxFn()` at
 * startup to wire the real implementation.
 *
 * Rule: this file MUST NOT import from `src/*` or any other package.
 * Everything is either node-builtin or a locally-defined fallback.
 */

// ---------------------------------------------------------------------------
// filesystem implementation — for error/diagnostic log sinks
// ---------------------------------------------------------------------------

export type FsImpl = {
  appendFileSync(path: string, data: string): void
  mkdirSync(path: string, options?: { recursive?: boolean }): void
  existsSync(path: string): boolean
  writeFileSync(path: string, data: string): void
  readFileSync(path: string, encoding: 'utf8'): string
  readdirSync(path: string): string[]
  statSync(path: string): { mtime: Date; isDirectory(): boolean }
  unlinkSync(path: string): void
}

let _fs: FsImpl | null = null

function nodeFsFallback(): FsImpl {
  // Lazy require so bundlers don't eagerly pull fs in pure-browser contexts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  return {
    appendFileSync: (p, d) => fs.appendFileSync(p, d),
    mkdirSync: (p, o) => fs.mkdirSync(p, { recursive: true, ...(o ?? {}) }),
    existsSync: p => fs.existsSync(p),
    writeFileSync: (p, d) => fs.writeFileSync(p, d),
    readFileSync: (p, e) => fs.readFileSync(p, e),
    readdirSync: p => fs.readdirSync(p) as string[],
    statSync: p => fs.statSync(p) as { mtime: Date; isDirectory(): boolean },
    unlinkSync: p => fs.unlinkSync(p),
  }
}

export function getFsImplementation(): FsImpl {
  if (!_fs) _fs = nodeFsFallback()
  return _fs
}

export function setFsImplementationFn(fs: FsImpl): void {
  _fs = fs
}

// ---------------------------------------------------------------------------
// cache paths — for error log / MCP log file locations
// ---------------------------------------------------------------------------

export type CachePaths = {
  errors(): string
  mcpLogs(serverName: string): string
}

let _cachePaths: CachePaths = {
  errors: () => {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '.'
    return `${home}/.claude/errors`
  },
  mcpLogs: (serverName: string) => {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '.'
    return `${home}/.claude/mcp-logs-${serverName}`
  },
}

export function getCachePaths(): CachePaths {
  return _cachePaths
}

export function setCachePathsFn(cachePaths: CachePaths): void {
  _cachePaths = cachePaths
}

// ---------------------------------------------------------------------------
// session id — used by telemetry attributes and error contexts
// ---------------------------------------------------------------------------

let _getSessionId: () => string = () => 'unknown-session'

export function getSessionId(): string {
  return _getSessionId()
}

export function setGetSessionIdFn(fn: () => string): void {
  _getSessionId = fn
}

// ---------------------------------------------------------------------------
// last API request capture hooks — used by captureAPIRequest
// ---------------------------------------------------------------------------

let _setLastAPIRequest: (params: unknown) => void = () => {}
let _setLastAPIRequestMessages: (messages: unknown) => void = () => {}

export function setLastAPIRequestFn(fn: (params: unknown) => void): void {
  _setLastAPIRequest = fn
}

export function setLastAPIRequestMessagesFn(fn: (messages: unknown) => void): void {
  _setLastAPIRequestMessages = fn
}

export function callSetLastAPIRequest(params: unknown): void {
  _setLastAPIRequest(params)
}

export function callSetLastAPIRequestMessages(messages: unknown): void {
  _setLastAPIRequestMessages(messages)
}

// ---------------------------------------------------------------------------
// privacy-level check — essential-traffic-only gating for error logging
// ---------------------------------------------------------------------------

let _isEssentialTrafficOnly: () => boolean = () => false

export function isEssentialTrafficOnly(): boolean {
  return _isEssentialTrafficOnly()
}

export function setIsEssentialTrafficOnlyFn(fn: () => boolean): void {
  _isEssentialTrafficOnly = fn
}

// ---------------------------------------------------------------------------
// cleanup registry — flush buffered writers on process exit
// ---------------------------------------------------------------------------

let _registerCleanup: (fn: () => void | Promise<void>) => void = () => {}

export function registerCleanup(fn: () => void | Promise<void>): void {
  _registerCleanup(fn)
}

export function setRegisterCleanupFn(fn: (cb: () => void | Promise<void>) => void): void {
  _registerCleanup = fn
}

// ---------------------------------------------------------------------------
// debug logger — `logForDebugging` from src/utils/debug.ts
// ---------------------------------------------------------------------------

let _logForDebugging: (message: string, ...args: unknown[]) => void = () => {}

export function logForDebugging(message: string, ...args: unknown[]): void {
  _logForDebugging(message, ...args)
}

export function setLogForDebuggingFn(fn: (message: string, ...args: unknown[]) => void): void {
  _logForDebugging = fn
}

// ---------------------------------------------------------------------------
// sentry captureException — optional exception reporter
// ---------------------------------------------------------------------------

let _captureException: (error: unknown) => void = () => {}

export function captureException(error: unknown): void {
  _captureException(error)
}

export function setCaptureExceptionFn(fn: (error: unknown) => void): void {
  _captureException = fn
}

// ---------------------------------------------------------------------------
// Inlined pure helpers — small enough to duplicate, avoids src/ import
// ---------------------------------------------------------------------------

/**
 * `isEnvTruthy` — duplicated from src/utils/envUtils.ts.
 * Small & pure; duplication is cheaper than a setter injection.
 */
export function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

/**
 * `toError` — duplicated from src/utils/errors.ts.
 * Accepts anything thrown, returns a proper Error.
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string') return new Error(value)
  try {
    return new Error(JSON.stringify(value))
  } catch {
    return new Error(String(value))
  }
}

/**
 * `jsonStringify` / `jsonParse` — thin wrappers matching slowOperations
 * semantics. Default to native JSON; hosts may override for logging
 * unusual payloads.
 */
let _jsonStringify: (value: unknown) => string = v => JSON.stringify(v)
let _jsonParse: (text: string) => unknown = t => JSON.parse(t)

export function jsonStringify(value: unknown): string {
  return _jsonStringify(value)
}

export function jsonParse(text: string): unknown {
  return _jsonParse(text)
}

export function setJsonStringifyFn(fn: (value: unknown) => string): void {
  _jsonStringify = fn
}

export function setJsonParseFn(fn: (text: string) => unknown): void {
  _jsonParse = fn
}

// ---------------------------------------------------------------------------
// Telemetry attribute sources — for getTelemetryAttributes()
// ---------------------------------------------------------------------------

export type OauthAccountInfo = {
  organizationUuid?: string
  emailAddress?: string
  accountUuid?: string
}

let _getOauthAccountInfo: () => OauthAccountInfo | null = () => null
let _getOrCreateUserID: () => string = () => 'anonymous-user'
let _getTerminalType: () => string | undefined = () => undefined
let _toTaggedId: (kind: string, id: string) => string = (kind, id) => `${kind}_${id}`

export function getOauthAccountInfo(): OauthAccountInfo | null {
  return _getOauthAccountInfo()
}

export function getOrCreateUserID(): string {
  return _getOrCreateUserID()
}

export function getTerminalType(): string | undefined {
  return _getTerminalType()
}

export function toTaggedId(kind: string, id: string): string {
  return _toTaggedId(kind, id)
}

export function setGetOauthAccountInfoFn(fn: () => OauthAccountInfo | null): void {
  _getOauthAccountInfo = fn
}

export function setGetOrCreateUserIDFn(fn: () => string): void {
  _getOrCreateUserID = fn
}

export function setGetTerminalTypeFn(fn: () => string | undefined): void {
  _getTerminalType = fn
}

export function setToTaggedIdFn(fn: (kind: string, id: string) => string): void {
  _toTaggedId = fn
}

// ---------------------------------------------------------------------------
// Env / path helpers — for perfetto tracing and future file-based telemetry
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

/**
 * `isEnvDefinedFalsy` — duplicated from src/utils/envUtils.ts.
 * Returns true iff value is defined AND falsy (0/false/no/off).
 */
export function isEnvDefinedFalsy(value: string | undefined): boolean {
  if (value === undefined) return false
  return ['0', 'false', 'no', 'off'].includes(value.toLowerCase())
}

// ---------------------------------------------------------------------------
// Teammate / agent identity — for perfetto swarm-hierarchy tracing
// ---------------------------------------------------------------------------

let _getAgentId: () => string | undefined = () => undefined
let _getAgentName: () => string | undefined = () => undefined
let _getParentSessionId: () => string | undefined = () => undefined

export function getAgentId(): string | undefined {
  return _getAgentId()
}

export function getAgentName(): string | undefined {
  return _getAgentName()
}

export function getParentSessionId(): string | undefined {
  return _getParentSessionId()
}

export function setGetAgentIdFn(fn: () => string | undefined): void {
  _getAgentId = fn
}

export function setGetAgentNameFn(fn: () => string | undefined): void {
  _getAgentName = fn
}

export function setGetParentSessionIdFn(fn: () => string | undefined): void {
  _getParentSessionId = fn
}

// ---------------------------------------------------------------------------
// Inlined pure helpers used by perfetto / tracing
// ---------------------------------------------------------------------------

/**
 * `errorMessage` — duplicated from src/utils/errors.ts.
 * Unwraps anything into a string message.
 */
export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * `djb2Hash` — duplicated from src/utils/hash.ts.
 * Classic string hash with good distribution for short strings.
 */
export function djb2Hash(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  return hash >>> 0
}
