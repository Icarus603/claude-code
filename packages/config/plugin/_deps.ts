/**
 * @claude-code/config/plugin/_deps
 *
 * V7 §3.2 ports-and-adapters — setter-based dependency injection for the
 * plugin subsystem. Wave-1 config/plugin package; depends only on
 * node builtins, @claude-code/local-observability, and itself.
 *
 * All 50+ cross-boundary dependencies previously pointing into
 * src/bootstrap/state, src/services/mcp, src/services/lsp, src/tools/*,
 * src/commands.js, src/state/AppState, and various src/utils/* are
 * funneled through setters here.
 *
 * The src-side bootstrap (src/runtime/installPluginBindings.ts) wires
 * each setter to the real implementation on startup.
 */

// ---------------------------------------------------------------------------
// Logging / diagnostics (re-injected — avoid cyclic imports)
// ---------------------------------------------------------------------------

let _logForDebugging: (message: string, ...args: unknown[]) => void = () => {}
let _logError: (error: unknown) => void = () => {}
let _logForDiagnosticsNoPII: (
  level: 'debug' | 'info' | 'warn' | 'error',
  event: string,
  data?: Record<string, unknown>,
) => void = () => {}

export function logForDebugging(message: string, ...args: unknown[]): void {
  _logForDebugging(message, ...args)
}
export function logError(error: unknown): void {
  _logError(error)
}
export function logForDiagnosticsNoPII(
  level: 'debug' | 'info' | 'warn' | 'error',
  event: string,
  data?: Record<string, unknown>,
): void {
  _logForDiagnosticsNoPII(level, event, data)
}
export function setLogForDebuggingFn(fn: typeof _logForDebugging): void {
  _logForDebugging = fn
}
export function setLogErrorFn(fn: typeof _logError): void {
  _logError = fn
}
export function setLogForDiagnosticsNoPIIFn(
  fn: typeof _logForDiagnosticsNoPII,
): void {
  _logForDiagnosticsNoPII = fn
}

// ---------------------------------------------------------------------------
// FS + path helpers
// ---------------------------------------------------------------------------

export type PluginFsImpl = {
  existsSync(path: string): boolean
  mkdirSync(path: string, options?: { recursive?: boolean }): void
  writeFileSync(path: string, data: string): void
  readFileSync(path: string, encoding: 'utf8'): string
  readdirSync(path: string): string[]
  statSync(path: string): { mtime: Date; isDirectory(): boolean; size: number }
  rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
  rmdirSync(path: string): void
  renameSync(oldPath: string, newPath: string): void
  appendFileSync(path: string, data: string): void
  cwd(): string
  realpathSync(path: string): string
  // Async methods (used by marketplaceManager, pluginLoader, etc)
  readFile(path: string, options?: { encoding?: 'utf-8' | 'utf8' }): Promise<string>
  readFileBytes(path: string): Promise<Uint8Array>
  writeFile(path: string, data: string | Uint8Array): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  readdir(path: string): Promise<string[]>
  stat(path: string): Promise<{ mtime: Date; isDirectory(): boolean; size: number }>
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
}

let _fs: PluginFsImpl | null = null

function nodeFsFallback(): PluginFsImpl {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsp = require('node:fs/promises') as typeof import('node:fs/promises')
  return {
    existsSync: p => fs.existsSync(p),
    mkdirSync: (p, o) => fs.mkdirSync(p, { recursive: true, ...(o ?? {}) }),
    writeFileSync: (p, d) => fs.writeFileSync(p, d),
    readFileSync: (p, e) => fs.readFileSync(p, e) as string,
    readdirSync: p => fs.readdirSync(p) as string[],
    statSync: p =>
      fs.statSync(p) as {
        mtime: Date
        isDirectory(): boolean
        size: number
      },
    rmSync: (p, o) => fs.rmSync(p, o),
    rmdirSync: p => fs.rmdirSync(p),
    renameSync: (o, n) => fs.renameSync(o, n),
    appendFileSync: (p, d) => fs.appendFileSync(p, d),
    cwd: () => process.cwd(),
    realpathSync: p => fs.realpathSync(p),
    readFile: async (p, opts) =>
      (await fsp.readFile(p, opts?.encoding ?? 'utf-8')) as string,
    readFileBytes: async p => new Uint8Array(await fsp.readFile(p)),
    writeFile: async (p, d) => fsp.writeFile(p, d),
    mkdir: async (p, o) => {
      await fsp.mkdir(p, { recursive: true, ...(o ?? {}) })
    },
    readdir: async p => (await fsp.readdir(p)) as string[],
    stat: async p =>
      (await fsp.stat(p)) as {
        mtime: Date
        isDirectory(): boolean
        size: number
      },
    rm: async (p, o) => fsp.rm(p, o),
    rename: async (o, n) => fsp.rename(o, n),
  }
}

export function getFsImplementation(): PluginFsImpl {
  if (!_fs) _fs = nodeFsFallback()
  return _fs
}
export function setFsImplementationFn(fs: PluginFsImpl): void {
  _fs = fs
}

// pathExists (async stat)
let _pathExists: (path: string) => Promise<boolean> = async p => {
  try {
    getFsImplementation().statSync(p)
    return true
  } catch {
    return false
  }
}
export function pathExists(path: string): Promise<boolean> {
  return _pathExists(path)
}
export function setPathExistsFn(fn: typeof _pathExists): void {
  _pathExists = fn
}

// writeFileSyncAndFlush (with fsync)
let _writeFileSyncAndFlush: (path: string, data: string) => void = (p, d) =>
  getFsImplementation().writeFileSync(p, d)
export function writeFileSyncAndFlush(path: string, data: string): void {
  _writeFileSyncAndFlush(path, data)
}
export function setWriteFileSyncAndFlushFn(
  fn: typeof _writeFileSyncAndFlush,
): void {
  _writeFileSyncAndFlush = fn
}

// safeResolvePath (prevents path-escape attacks)
let _safeResolvePath: (base: string, rel: string) => string | null = () => null
export function safeResolvePath(base: string, rel: string): string | null {
  return _safeResolvePath(base, rel)
}
export function setSafeResolvePathFn(fn: typeof _safeResolvePath): void {
  _safeResolvePath = fn
}

// ---------------------------------------------------------------------------
// Session + cwd state
// ---------------------------------------------------------------------------

let _getSessionId: () => string = () => 'unknown-session'
let _getOriginalCwd: () => string = () => process.cwd()
let _getCwd: () => string = () => process.cwd()
let _getInlinePlugins: () => Record<string, unknown> | undefined = () =>
  undefined

export function getSessionId(): string {
  return _getSessionId()
}
export function getOriginalCwd(): string {
  return _getOriginalCwd()
}
export function getCwd(): string {
  return _getCwd()
}
export function getInlinePlugins(): Record<string, unknown> | undefined {
  return _getInlinePlugins()
}
export function setGetSessionIdFn(fn: typeof _getSessionId): void {
  _getSessionId = fn
}
export function setGetOriginalCwdFn(fn: typeof _getOriginalCwd): void {
  _getOriginalCwd = fn
}
export function setGetCwdFn(fn: typeof _getCwd): void {
  _getCwd = fn
}
export function setGetInlinePluginsFn(fn: typeof _getInlinePlugins): void {
  _getInlinePlugins = fn
}

// ---------------------------------------------------------------------------
// Settings accessors (delegated to @claude-code/config/settings at host-side)
// ---------------------------------------------------------------------------

type SettingsJsonLike = Record<string, unknown> & {
  env?: Record<string, string>
}

let _getSettings_DEPRECATED: () => SettingsJsonLike | undefined = () =>
  undefined
let _getSettingsForSource: (source: string) => SettingsJsonLike | undefined = () =>
  undefined
let _isSettingSourceEnabled: (source: string) => boolean = () => true

export function getSettings_DEPRECATED(): SettingsJsonLike | undefined {
  return _getSettings_DEPRECATED()
}
export function getSettingsForSource(
  source: string,
): SettingsJsonLike | undefined {
  return _getSettingsForSource(source)
}
export function isSettingSourceEnabled(source: string): boolean {
  return _isSettingSourceEnabled(source)
}
export function setGetSettings_DEPRECATEDFn(
  fn: typeof _getSettings_DEPRECATED,
): void {
  _getSettings_DEPRECATED = fn
}
export function setGetSettingsForSourceFn(
  fn: typeof _getSettingsForSource,
): void {
  _getSettingsForSource = fn
}
export function setIsSettingSourceEnabledFn(
  fn: typeof _isSettingSourceEnabled,
): void {
  _isSettingSourceEnabled = fn
}

// ---------------------------------------------------------------------------
// AppState (transitional — V7 goal is to eliminate AppState)
// ---------------------------------------------------------------------------

let _getAppState: () => unknown = () => ({})
let _setAppState: (updater: (state: unknown) => unknown) => void = () => {}
export function getAppState<T = unknown>(): T {
  return _getAppState() as T
}
export function setAppState<T>(updater: (state: T) => T): void {
  _setAppState(updater as (state: unknown) => unknown)
}
export function setGetAppStateFn(fn: typeof _getAppState): void {
  _getAppState = fn
}
export function setSetAppStateFn(fn: typeof _setAppState): void {
  _setAppState = fn
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

let _gitExe: () => Promise<string> = async () => 'git'
let _getHeadForDir: (dir: string) => Promise<string | null> = async () => null

export function gitExe(): Promise<string> {
  return _gitExe()
}
export function getHeadForDir(dir: string): Promise<string | null> {
  return _getHeadForDir(dir)
}
export function setGitExeFn(fn: typeof _gitExe): void {
  _gitExe = fn
}
export function setGetHeadForDirFn(fn: typeof _getHeadForDir): void {
  _getHeadForDir = fn
}

// ---------------------------------------------------------------------------
// Subprocess execution
// ---------------------------------------------------------------------------

export type ExecResult = {
  code: number
  stdout: string
  stderr: string
}

let _execFileNoThrow: (
  cmd: string,
  args: string[],
  options?: { timeout?: number; env?: NodeJS.ProcessEnv },
) => Promise<ExecResult> = async () => ({ code: -1, stdout: '', stderr: '' })

let _execFileNoThrowWithCwd: (
  cmd: string,
  args: string[],
  cwd: string,
  options?: { timeout?: number; env?: NodeJS.ProcessEnv },
) => Promise<ExecResult> = async () => ({ code: -1, stdout: '', stderr: '' })

export function execFileNoThrow(
  cmd: string,
  args: string[],
  options?: { timeout?: number; env?: NodeJS.ProcessEnv },
): Promise<ExecResult> {
  return _execFileNoThrow(cmd, args, options)
}
export function execFileNoThrowWithCwd(
  cmd: string,
  args: string[],
  cwd: string,
  options?: { timeout?: number; env?: NodeJS.ProcessEnv },
): Promise<ExecResult> {
  return _execFileNoThrowWithCwd(cmd, args, cwd, options)
}
export function setExecFileNoThrowFn(fn: typeof _execFileNoThrow): void {
  _execFileNoThrow = fn
}
export function setExecFileNoThrowWithCwdFn(
  fn: typeof _execFileNoThrowWithCwd,
): void {
  _execFileNoThrowWithCwd = fn
}

// ---------------------------------------------------------------------------
// `which` + `binaryCheck`
// ---------------------------------------------------------------------------

let _which: (cmd: string) => Promise<string | null> = async () => null
let _checkBinaryExists: (cmd: string) => Promise<boolean> = async () => false

export function which(cmd: string): Promise<string | null> {
  return _which(cmd)
}
export function checkBinaryExists(cmd: string): Promise<boolean> {
  return _checkBinaryExists(cmd)
}
export function setWhichFn(fn: typeof _which): void {
  _which = fn
}
export function setCheckBinaryExistsFn(fn: typeof _checkBinaryExists): void {
  _checkBinaryExists = fn
}

// ---------------------------------------------------------------------------
// Pure helpers (inlined from various src/utils)
// ---------------------------------------------------------------------------

/** from src/utils/envUtils */
export function isEnvTruthy(v: string | boolean | undefined): boolean {
  if (!v) return false
  if (typeof v === 'boolean') return v
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase().trim())
}

export function isEnvDefinedFalsy(v: string | boolean | undefined): boolean {
  if (v === undefined) return false
  if (typeof v === 'boolean') return !v
  if (!v) return false
  return ['0', 'false', 'no', 'off'].includes(v.toLowerCase().trim())
}

/** from src/utils/errors */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string') return new Error(value)
  try {
    return new Error(JSON.stringify(value))
  } catch {
    return new Error(String(value))
  }
}

export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function getErrnoCode(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'code' in e && typeof e.code === 'string') {
    return e.code
  }
  return undefined
}

export function isENOENT(e: unknown): boolean {
  return getErrnoCode(e) === 'ENOENT'
}

/** from src/utils/slowOperations */
let _jsonStringify: (v: unknown) => string = v => JSON.stringify(v)
let _jsonParse: (t: string) => unknown = t => JSON.parse(t)
let _clone: <T>(v: T) => T = v => JSON.parse(JSON.stringify(v))
export function jsonStringify(v: unknown): string {
  return _jsonStringify(v)
}
export function jsonParse(t: string): unknown {
  return _jsonParse(t)
}
export function clone<T>(v: T): T {
  return _clone(v)
}
export function setJsonStringifyFn(fn: typeof _jsonStringify): void {
  _jsonStringify = fn
}
export function setJsonParseFn(fn: typeof _jsonParse): void {
  _jsonParse = fn
}
export function setCloneFn(fn: typeof _clone): void {
  _clone = fn
}

/** safe JSON.parse — returns null on error */
export function safeParseJSON(json: string | null | undefined): unknown {
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Cleanup registry
// ---------------------------------------------------------------------------

let _registerCleanup: (fn: () => void | Promise<void>) => void = () => {}
export function registerCleanup(fn: () => void | Promise<void>): void {
  _registerCleanup(fn)
}
export function setRegisterCleanupFn(fn: typeof _registerCleanup): void {
  _registerCleanup = fn
}

// ---------------------------------------------------------------------------
// LSP + MCP integration deps
// ---------------------------------------------------------------------------

let _getLspManager: () => unknown = () => undefined
let _getMcpTypes: () => unknown = () => undefined
let _expandMcpEnv: (env: Record<string, string>) => Record<string, string> = e =>
  e
let _getMcpServerConfigSchema: () => unknown = () => undefined

export function getLspManager(): unknown {
  return _getLspManager()
}
export function getMcpTypes(): unknown {
  return _getMcpTypes()
}
export function expandMcpEnv(
  env: Record<string, string>,
): Record<string, string> {
  return _expandMcpEnv(env)
}
export function getMcpServerConfigSchema(): unknown {
  return _getMcpServerConfigSchema()
}
export function setGetLspManagerFn(fn: typeof _getLspManager): void {
  _getLspManager = fn
}
export function setGetMcpTypesFn(fn: typeof _getMcpTypes): void {
  _getMcpTypes = fn
}
export function setExpandMcpEnvFn(fn: typeof _expandMcpEnv): void {
  _expandMcpEnv = fn
}
export function setGetMcpServerConfigSchemaFn(
  fn: typeof _getMcpServerConfigSchema,
): void {
  _getMcpServerConfigSchema = fn
}

// ---------------------------------------------------------------------------
// Skill / Agent / Tool prompt providers (used by plugin loaders)
// ---------------------------------------------------------------------------

let _getCharBudget: () => number = () => 10000
let _loadAgentsDir: (...args: unknown[]) => Promise<unknown[]> = async () => []
let _agentColorManager: unknown = null
let _fileEditConstants: unknown = null
let _fileReadPrompt: unknown = null
let _fileWritePrompt: unknown = null
let _skillToolPrompt: unknown = null

export function getCharBudget(): number {
  return _getCharBudget()
}
export function loadAgentsDir(...args: unknown[]): Promise<unknown[]> {
  return _loadAgentsDir(...args)
}
export function getAgentColorManager(): unknown {
  return _agentColorManager
}
export function getFileEditConstants(): unknown {
  return _fileEditConstants
}
export function getFileReadPrompt(): unknown {
  return _fileReadPrompt
}
export function getFileWritePrompt(): unknown {
  return _fileWritePrompt
}
export function getSkillToolPrompt(): unknown {
  return _skillToolPrompt
}
export function setGetCharBudgetFn(fn: typeof _getCharBudget): void {
  _getCharBudget = fn
}
export function setLoadAgentsDirFn(fn: typeof _loadAgentsDir): void {
  _loadAgentsDir = fn
}
export function setAgentColorManagerFn(v: unknown): void {
  _agentColorManager = v
}
export function setFileEditConstantsFn(v: unknown): void {
  _fileEditConstants = v
}
export function setFileReadPromptFn(v: unknown): void {
  _fileReadPrompt = v
}
export function setFileWritePromptFn(v: unknown): void {
  _fileWritePrompt = v
}
export function setSkillToolPromptFn(v: unknown): void {
  _skillToolPrompt = v
}

// ---------------------------------------------------------------------------
// Commands registry (plugin-loaded commands flow through this)
// ---------------------------------------------------------------------------

let _registerCommands: (commands: unknown[]) => void = () => {}
let _getCommandsType: () => unknown = () => undefined
export function registerCommands(commands: unknown[]): void {
  _registerCommands(commands)
}
export function setRegisterCommandsFn(fn: typeof _registerCommands): void {
  _registerCommands = fn
}
export function setGetCommandsTypeFn(fn: typeof _getCommandsType): void {
  _getCommandsType = fn
}

// ---------------------------------------------------------------------------
// Plugin operations — services/plugins/pluginOperations re-injected for
// the utils → services back-dependency that existed before the move.
// ---------------------------------------------------------------------------

let _pluginOperations: unknown = null
export function getPluginOperations(): unknown {
  return _pluginOperations
}
export function setPluginOperationsFn(v: unknown): void {
  _pluginOperations = v
}

// ---------------------------------------------------------------------------
// Output styles, ripgrep, secure storage, telemetry, etc.
// ---------------------------------------------------------------------------

let _rgPath: () => string | null = () => null
let _getOutputStyleDirSuffix: () => string = () => ''
let _secureStorageRead: (key: string) => Promise<string | null> = async () =>
  null
let _secureStorageWrite: (key: string, value: string) => Promise<void> =
  async () => {}

export function rgPath(): string | null {
  return _rgPath()
}
export function getOutputStyleDirSuffix(): string {
  return _getOutputStyleDirSuffix()
}
export function secureStorageRead(key: string): Promise<string | null> {
  return _secureStorageRead(key)
}
export function secureStorageWrite(key: string, value: string): Promise<void> {
  return _secureStorageWrite(key, value)
}
export function setRgPathFn(fn: typeof _rgPath): void {
  _rgPath = fn
}
export function setGetOutputStyleDirSuffixFn(
  fn: typeof _getOutputStyleDirSuffix,
): void {
  _getOutputStyleDirSuffix = fn
}
export function setSecureStorageReadFn(fn: typeof _secureStorageRead): void {
  _secureStorageRead = fn
}
export function setSecureStorageWriteFn(fn: typeof _secureStorageWrite): void {
  _secureStorageWrite = fn
}

// ---------------------------------------------------------------------------
// Plugin telemetry event builders (src/utils/telemetry/pluginTelemetry)
// ---------------------------------------------------------------------------

let _buildPluginTelemetryFields: (...args: unknown[]) => Record<string, unknown> =
  () => ({})
let _classifyPluginCommandError: (error: unknown) => string = () => 'unknown'

export function buildPluginTelemetryFields(
  ...args: unknown[]
): Record<string, unknown> {
  return _buildPluginTelemetryFields(...args)
}
export function classifyPluginCommandError(error: unknown): string {
  return _classifyPluginCommandError(error)
}
export function setBuildPluginTelemetryFieldsFn(
  fn: typeof _buildPluginTelemetryFields,
): void {
  _buildPluginTelemetryFields = fn
}
export function setClassifyPluginCommandErrorFn(
  fn: typeof _classifyPluginCommandError,
): void {
  _classifyPluginCommandError = fn
}

// ---------------------------------------------------------------------------
// Miscellaneous util functions moved into deps (dxt, effort, format,
// frontmatterParser, markdownConfigLoader, yaml, stringUtils, etc.)
//
// These are small helpers plugin files use; inject via setter to keep the
// package src/-free.
// ---------------------------------------------------------------------------

let _sanitizePath: (path: string) => string = p => p
let _parseMarkdownFrontmatter: (text: string) => {
  frontmatter: Record<string, unknown>
  body: string
} = () => ({ frontmatter: {}, body: '' })
let _loadMarkdownConfig: (path: string) => unknown = () => null
let _walkMarkdownFiles: (dir: string) => Promise<string[]> = async () => []

export function sanitizePath(path: string): string {
  return _sanitizePath(path)
}
export function parseMarkdownFrontmatter(
  text: string,
): { frontmatter: Record<string, unknown>; body: string } {
  return _parseMarkdownFrontmatter(text)
}
export function loadMarkdownConfig(path: string): unknown {
  return _loadMarkdownConfig(path)
}
export function walkMarkdownFiles(dir: string): Promise<string[]> {
  return _walkMarkdownFiles(dir)
}
export function setSanitizePathFn(fn: typeof _sanitizePath): void {
  _sanitizePath = fn
}
export function setParseMarkdownFrontmatterFn(
  fn: typeof _parseMarkdownFrontmatter,
): void {
  _parseMarkdownFrontmatter = fn
}
export function setLoadMarkdownConfigFn(fn: typeof _loadMarkdownConfig): void {
  _loadMarkdownConfig = fn
}
export function setWalkMarkdownFilesFn(fn: typeof _walkMarkdownFiles): void {
  _walkMarkdownFiles = fn
}

// ---------------------------------------------------------------------------
// Additional setter surface discovered during bulk rewrite (builtin list,
// hints engine, CLI argument substitution).
// ---------------------------------------------------------------------------

let _builtinPlugins: unknown = {}
let _claudeCodeHints: unknown = {}
let _argumentSubstitution: unknown = {}

export function getBuiltinPlugins(): unknown {
  return _builtinPlugins
}
export function getClaudeCodeHints(): unknown {
  return _claudeCodeHints
}
export function getArgumentSubstitution(): unknown {
  return _argumentSubstitution
}

export function setClaudeCodeHintsFn(v: unknown): void {
  _claudeCodeHints = v
}
export function setArgumentSubstitutionFn(v: unknown): void {
  _argumentSubstitution = v
}

// Setter-based exports — callers that previously imported direct functions
// from src/plugins/builtinPlugins.ts now receive dynamic references. Host-side
// installPluginBindings wires real implementations at startup; defaults
// return the empty shapes the callers expect (so spread doesn't throw).
type BuiltinPluginResult = { enabled: unknown[]; disabled: unknown[] }

let _getBuiltinPluginsFn: () => BuiltinPluginResult = () => ({
  enabled: [],
  disabled: [],
})
let _isBuiltinPluginIdFn: (id: string) => boolean = () => false
let _getBuiltinPluginDefinitionFn: (id: string) => unknown = () => undefined

// getBuiltinPlugins — returns { enabled, disabled } of LoadedPlugins.
// Host wires this to src/plugins/builtinPlugins.ts#getBuiltinPlugins.
export function getBuiltinPlugins(): BuiltinPluginResult {
  return _getBuiltinPluginsFn()
}

// isBuiltinPluginId — "is this id a builtin?" predicate.
export function isBuiltinPluginId(id: string): boolean {
  return _isBuiltinPluginIdFn(id)
}

// getBuiltinPluginDefinition — per-id definition lookup.
export function getBuiltinPluginDefinition(id: string): unknown {
  return _getBuiltinPluginDefinitionFn(id)
}

// Constant-lookalike collections kept as getter-backed proxies so existing
// callers that iterate them (e.g., `for (const id of BUILTIN_PLUGIN_IDS)`)
// see the wired contents.
function getBuiltinSnapshot(): {
  idList: string[]
  map: Record<string, unknown>
} {
  const result = _getBuiltinPluginsFn()
  const all = [...result.enabled, ...result.disabled]
  const map: Record<string, unknown> = {}
  const idList: string[] = []
  for (const plugin of all) {
    const pid = (plugin as { id?: string; name?: string })?.id ??
      (plugin as { name?: string })?.name
    if (pid) {
      map[pid] = plugin
      idList.push(pid)
    }
  }
  return { idList, map }
}

export const BUILTIN_PLUGINS: Record<string, unknown> = new Proxy(
  {} as Record<string, unknown>,
  {
    ownKeys: () => Object.keys(getBuiltinSnapshot().map),
    getOwnPropertyDescriptor: (_t, key) =>
      Object.getOwnPropertyDescriptor(getBuiltinSnapshot().map, key),
    has: (_t, key) => key in getBuiltinSnapshot().map,
    get: (_t, key) => getBuiltinSnapshot().map[key as string],
  },
)

export const BUILTIN_PLUGIN_IDS: string[] = new Proxy([] as string[], {
  get: (_t, key) => {
    const snap = getBuiltinSnapshot().idList
    if (key === 'length') return snap.length
    if (typeof key === 'string' && /^\d+$/.test(key)) return snap[Number(key)]
    return (snap as unknown as Record<string | symbol, unknown>)[key]
  },
  has: (_t, key) => key in getBuiltinSnapshot().idList,
  ownKeys: () => Object.keys(getBuiltinSnapshot().idList),
  getOwnPropertyDescriptor: (_t, key) =>
    Object.getOwnPropertyDescriptor(getBuiltinSnapshot().idList, key),
}) as unknown as string[]

export function setGetBuiltinPluginsFn(fn: () => BuiltinPluginResult): void {
  _getBuiltinPluginsFn = fn
}
export function setIsBuiltinPluginIdFn(fn: (id: string) => boolean): void {
  _isBuiltinPluginIdFn = fn
}
export function setGetBuiltinPluginDefinitionFn(
  fn: (id: string) => unknown,
): void {
  _getBuiltinPluginDefinitionFn = fn
}
// Backward compat — some call sites setter-named variants
export const setBuiltinPluginsFn = setGetBuiltinPluginsFn as unknown as (
  fn: () => BuiltinPluginResult,
) => void
export const setBuiltinPluginIdsListFn = (): void => {}

let _applyArgumentSubstitutionsFn: (s: string, ...args: unknown[]) => string = s => s
export function applyArgumentSubstitutions(s: string, ...args: unknown[]): string {
  return _applyArgumentSubstitutionsFn(s, ...args)
}
export function setApplyArgumentSubstitutionsFn(
  fn: (s: string, ...args: unknown[]) => string,
): void {
  _applyArgumentSubstitutionsFn = fn
}

let _getHintsProviderFn: () => unknown = () => null
export function getHintsProvider(): unknown {
  return _getHintsProviderFn()
}
export function setGetHintsProviderFn(fn: () => unknown): void {
  _getHintsProviderFn = fn
}

// ---------------------------------------------------------------------------
// Round-4 batch additions: stub setters/exports for the 59 additional names
// imported by the migrated plugin files. Each has a safe default; host-side
// installPluginBindings wires real implementations.
// ---------------------------------------------------------------------------

// Constants (hard-coded so can't be overridden at runtime — acceptable because
// these are stable identifiers that rarely change).
export const BUILTIN_MARKETPLACE_NAME = 'anthropics'
export const FILE_EDIT_TOOL_NAME = 'Edit'
export const FILE_READ_TOOL_NAME = 'Read'
export const FILE_WRITE_TOOL_NAME = 'Write'
export const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?/
export const EFFORT_LEVELS = ['low', 'medium', 'high'] as const

// Types (structural passthroughs)
export type ClaudeCodeHint = { id: string; message: string; cta?: string }
export class ConfigParseError extends Error {
  readonly path?: string
  constructor(message: string, path?: string) {
    super(message)
    this.name = 'ConfigParseError'
    this.path = path
  }
}
export type FrontmatterData = Record<string, unknown>
export type ScopedMcpServerConfig = unknown
export const McpServerConfigSchema: unknown = null

// Setter-based functions — default implementations are no-ops or conservative
// fallbacks. Host wires the real impl in installPluginBindings.

function makeSetter<F>(defaultFn: F): [getter: () => F, setter: (fn: F) => void] {
  let current = defaultFn
  return [() => current, (fn: F) => { current = fn }]
}

// -- cache clearers
const [_getClearAgentDefinitionsCache, setClearAgentDefinitionsCacheFn_] = makeSetter(() => {})
const [_getClearAllOutputStylesCache, setClearAllOutputStylesCacheFn_] = makeSetter(() => {})
const [_getClearCommandsCache, setClearCommandsCacheFn_] = makeSetter(() => {})
const [_getClearPromptCache, setClearPromptCacheFn_] = makeSetter(() => {})
const [_getClearRegisteredPluginHooks, setClearRegisteredPluginHooksFn_] = makeSetter(() => {})
export function clearAgentDefinitionsCache(): void { _getClearAgentDefinitionsCache()() }
export function clearAllOutputStylesCache(): void { _getClearAllOutputStylesCache()() }
export function clearCommandsCache(): void { _getClearCommandsCache()() }
export function clearPromptCache(): void { _getClearPromptCache()() }
export function clearRegisteredPluginHooks(): void { _getClearRegisteredPluginHooks()() }
export const setClearAgentDefinitionsCacheFn = setClearAgentDefinitionsCacheFn_
export const setClearAllOutputStylesCacheFn = setClearAllOutputStylesCacheFn_
export const setClearCommandsCacheFn = setClearCommandsCacheFn_
export const setClearPromptCacheFn = setClearPromptCacheFn_
export const setClearRegisteredPluginHooksFn = setClearRegisteredPluginHooksFn_

// -- string / parse helpers
export function coerceDescriptionToString(v: unknown): string {
  if (typeof v === 'string') return v
  if (v == null) return ''
  return String(v)
}
const [_getExtractDescriptionFromMarkdown, setExtractDescriptionFromMarkdownFn_] = makeSetter((_text: string): string => '')
const [_getExpandTilde, setExpandTildeFn_] = makeSetter((p: string): string => p)
const [_getExpandEnvVarsInString, setExpandEnvVarsInStringFn_] = makeSetter((s: string): string => s)
const [_getExecuteShellCommandsInPrompt, setExecuteShellCommandsInPromptFn_] = makeSetter(async (_prompt: string): Promise<string> => '')
const [_getRipGrep, setRipGrepFn_] = makeSetter(async (..._args: unknown[]): Promise<string> => '')
const [_getUnzipFile, setUnzipFileFn_] = makeSetter(async (_zipPath: string, _destDir: string): Promise<void> => {})
export function extractDescriptionFromMarkdown(text: string): string { return _getExtractDescriptionFromMarkdown()(text) }
export function expandTilde(p: string): string { return _getExpandTilde()(p) }
export function expandEnvVarsInString(s: string): string { return _getExpandEnvVarsInString()(s) }
export function executeShellCommandsInPrompt(prompt: string): Promise<string> { return _getExecuteShellCommandsInPrompt()(prompt) }
export function ripGrep(...args: unknown[]): Promise<string> { return _getRipGrep()(...args) }
export function unzipFile(zipPath: string, destDir: string): Promise<void> { return _getUnzipFile()(zipPath, destDir) }
export const setExtractDescriptionFromMarkdownFn = setExtractDescriptionFromMarkdownFn_
export const setExpandTildeFn = setExpandTildeFn_
export const setExpandEnvVarsInStringFn = setExpandEnvVarsInStringFn_
export const setExecuteShellCommandsInPromptFn = setExecuteShellCommandsInPromptFn_
export const setRipGrepFn = setRipGrepFn_
export const setUnzipFileFn = setUnzipFileFn_

// -- frontmatter parsers
const [_getParseFrontmatter, setParseFrontmatterFn_] = makeSetter((_t: string): FrontmatterData => ({}))
const [_getParseAgentToolsFromFrontmatter, setParseAgentToolsFromFrontmatterFn_] = makeSetter((_v: unknown): string[] => [])
const [_getParseSlashCommandToolsFromFrontmatter, setParseSlashCommandToolsFromFrontmatterFn_] = makeSetter((_v: unknown): string[] => [])
const [_getParseShellFrontmatter, setParseShellFrontmatterFn_] = makeSetter((_v: unknown): unknown => null)
const [_getParseBooleanFrontmatter, setParseBooleanFrontmatterFn_] = makeSetter((_v: unknown): boolean | undefined => undefined)
const [_getParsePositiveIntFromFrontmatter, setParsePositiveIntFromFrontmatterFn_] = makeSetter((_v: unknown): number | undefined => undefined)
const [_getParseEffortValue, setParseEffortValueFn_] = makeSetter((_v: unknown): 'low' | 'medium' | 'high' | undefined => undefined)
const [_getParseYaml, setParseYamlFn_] = makeSetter((_s: string): unknown => null)
const [_getParseArgumentNames, setParseArgumentNamesFn_] = makeSetter((_s: string): string[] => [])
const [_getParseUserSpecifiedModel, setParseUserSpecifiedModelFn_] = makeSetter((_v: unknown): string | undefined => undefined)
const [_getParseZipModes, setParseZipModesFn_] = makeSetter((_v: unknown): unknown => null)
const [_getSubstituteArguments, setSubstituteArgumentsFn_] = makeSetter((s: string, _args: Record<string, string>): string => s)
const [_getParseAndValidateManifestFromBytes, setParseAndValidateManifestFromBytesFn_] = makeSetter(async (_bytes: Uint8Array): Promise<unknown> => null)
export function parseFrontmatter(t: string): FrontmatterData { return _getParseFrontmatter()(t) }
export function parseAgentToolsFromFrontmatter(v: unknown): string[] { return _getParseAgentToolsFromFrontmatter()(v) }
export function parseSlashCommandToolsFromFrontmatter(v: unknown): string[] { return _getParseSlashCommandToolsFromFrontmatter()(v) }
export function parseShellFrontmatter(v: unknown): unknown { return _getParseShellFrontmatter()(v) }
export function parseBooleanFrontmatter(v: unknown): boolean | undefined { return _getParseBooleanFrontmatter()(v) }
export function parsePositiveIntFromFrontmatter(v: unknown): number | undefined { return _getParsePositiveIntFromFrontmatter()(v) }
export function parseEffortValue(v: unknown): 'low' | 'medium' | 'high' | undefined { return _getParseEffortValue()(v) }
export function parseYaml(s: string): unknown { return _getParseYaml()(s) }
export function parseArgumentNames(s: string): string[] { return _getParseArgumentNames()(s) }
export function parseUserSpecifiedModel(v: unknown): string | undefined { return _getParseUserSpecifiedModel()(v) }
export function parseZipModes(v: unknown): unknown { return _getParseZipModes()(v) }
export function substituteArguments(s: string, args: Record<string, string>): string { return _getSubstituteArguments()(s, args) }
export function parseAndValidateManifestFromBytes(bytes: Uint8Array): Promise<unknown> { return _getParseAndValidateManifestFromBytes()(bytes) }
export const setParseFrontmatterFn = setParseFrontmatterFn_
export const setParseAgentToolsFromFrontmatterFn = setParseAgentToolsFromFrontmatterFn_
export const setParseSlashCommandToolsFromFrontmatterFn = setParseSlashCommandToolsFromFrontmatterFn_
export const setParseShellFrontmatterFn = setParseShellFrontmatterFn_
export const setParseBooleanFrontmatterFn = setParseBooleanFrontmatterFn_
export const setParsePositiveIntFromFrontmatterFn = setParsePositiveIntFromFrontmatterFn_
export const setParseEffortValueFn = setParseEffortValueFn_
export const setParseYamlFn = setParseYamlFn_
export const setParseArgumentNamesFn = setParseArgumentNamesFn_
export const setParseUserSpecifiedModelFn = setParseUserSpecifiedModelFn_
export const setParseZipModesFn = setParseZipModesFn_
export const setSubstituteArgumentsFn = setSubstituteArgumentsFn_
export const setParseAndValidateManifestFromBytesFn = setParseAndValidateManifestFromBytesFn_

// -- registered hooks, agent/command caches
const [_getRegisteredHooks_, setGetRegisteredHooksFn_] = makeSetter((): unknown[] => [])
const [_getRegisterHookCallbacks, setRegisterHookCallbacksFn_] = makeSetter((_hooks: unknown[]): void => {})
const [_getGetAgentDefinitionsWithOverrides, setGetAgentDefinitionsWithOverridesFn_] = makeSetter(async (..._args: unknown[]): Promise<unknown[]> => [])
export function getRegisteredHooks(): unknown[] { return _getRegisteredHooks_()() }
export function registerHookCallbacks(hooks: unknown[]): void { _getRegisterHookCallbacks()(hooks) }
export function getAgentDefinitionsWithOverrides(...args: unknown[]): Promise<unknown[]> { return _getGetAgentDefinitionsWithOverrides()(...args) }
export const setGetRegisteredHooksFn = setGetRegisteredHooksFn_
export const setRegisterHookCallbacksFn = setRegisterHookCallbacksFn_
export const setGetAgentDefinitionsWithOverridesFn = setGetAgentDefinitionsWithOverridesFn_

// -- misc utils
export function getErrnoPath(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'path' in e) return (e as { path?: string }).path
  return undefined
}
export function isBinaryInstalled(_cmd: string): Promise<boolean> { return checkBinaryExists(_cmd) }
export function isDuplicatePath(a: string, b: string): boolean { return a === b }
const [_getIsFsInaccessible, setIsFsInaccessibleFn_] = makeSetter((_err: unknown): boolean => false)
export function isFsInaccessible(err: unknown): boolean { return _getIsFsInaccessible()(err) }
export const setIsFsInaccessibleFn = setIsFsInaccessibleFn_

const [_getPlural, setPluralFn_] = makeSetter((n: number, singular: string, plural?: string): string => {
  if (n === 1) return `${n} ${singular}`
  return `${n} ${plural ?? singular + 's'}`
})
export function plural(n: number, singular: string, plural?: string): string { return _getPlural()(n, singular, plural) }
export const setPluralFn = setPluralFn_

// -- hint + hint state
const [_getHasShownHintThisSession, setHasShownHintThisSessionFn_] = makeSetter((_id: string): boolean => false)
const [_getSetPendingHint, setSetPendingHintFn_] = makeSetter((_hint: ClaudeCodeHint | null): void => {})
const [_getResetHintRecommendationForTesting, setResetHintRecommendationForTestingFn_] = makeSetter((): void => {})
export function hasShownHintThisSession(id: string): boolean { return _getHasShownHintThisSession()(id) }
export function setPendingHint(hint: ClaudeCodeHint | null): void { _getSetPendingHint()(hint) }
export function _resetHintRecommendationForTesting(): void { _getResetHintRecommendationForTesting()() }
export const setHasShownHintThisSessionFn = setHasShownHintThisSessionFn_
export const setSetPendingHintFn = setSetPendingHintFn_
export const setResetHintRecommendationForTestingFn = setResetHintRecommendationForTestingFn_

// -- system directories + git + misc
const [_getGetSystemDirectories, setGetSystemDirectoriesFn_] = makeSetter((): string[] => [])
const [_getFindCanonicalGitRoot, setFindCanonicalGitRootFn_] = makeSetter((_cwd: string): string | null => null)
const [_getGetAdditionalDirectoriesForClaudeMd, setGetAdditionalDirectoriesForClaudeMdFn_] = makeSetter((): string[] => [])
const [_getGetUseCoworkPlugins, setGetUseCoworkPluginsFn_] = makeSetter((): boolean => false)
const [_getResetSentSkillNames, setResetSentSkillNamesFn_] = makeSetter((): void => {})
const [_getReinitializeLspServerManager, setReinitializeLspServerManagerFn_] = makeSetter((): Promise<void> => Promise.resolve())
const [_getWaitForScrollIdle, setWaitForScrollIdleFn_] = makeSetter((): Promise<void> => Promise.resolve())
const [_getWithDiagnosticsTiming, setWithDiagnosticsTimingFn_] = makeSetter(async <T>(_event: string, fn: () => Promise<T>): Promise<T> => fn())
const [_getGetSecureStorage, setGetSecureStorageFn_] = makeSetter((): unknown => null)
const [_getUninstallPluginOp, setUninstallPluginOpFn_] = makeSetter(async (..._args: unknown[]): Promise<unknown> => null)
const [_getUpdatePluginOp, setUpdatePluginOpFn_] = makeSetter(async (..._args: unknown[]): Promise<unknown> => null)
const [_getWriteFileSync_DEPRECATED, setWriteFileSync_DEPRECATEDFn_] = makeSetter((p: string, d: string): void => getFsImplementation().writeFileSync(p, d))
export function getSystemDirectories(): string[] { return _getGetSystemDirectories()() }
export function findCanonicalGitRoot(cwd: string): string | null { return _getFindCanonicalGitRoot()(cwd) }
export function getAdditionalDirectoriesForClaudeMd(): string[] { return _getGetAdditionalDirectoriesForClaudeMd()() }
export function getUseCoworkPlugins(): boolean { return _getGetUseCoworkPlugins()() }
export function resetSentSkillNames(): void { _getResetSentSkillNames()() }
export function reinitializeLspServerManager(): Promise<void> { return _getReinitializeLspServerManager()() }
export function waitForScrollIdle(): Promise<void> { return _getWaitForScrollIdle()() }
export function withDiagnosticsTiming<T>(event: string, fn: () => Promise<T>): Promise<T> { return _getWithDiagnosticsTiming()(event, fn) }
export function getSecureStorage(): unknown { return _getGetSecureStorage()() }
export function uninstallPluginOp(...args: unknown[]): Promise<unknown> { return _getUninstallPluginOp()(...args) }
export function updatePluginOp(...args: unknown[]): Promise<unknown> { return _getUpdatePluginOp()(...args) }
export function writeFileSync_DEPRECATED(p: string, d: string): void { _getWriteFileSync_DEPRECATED()(p, d) }
export const setGetSystemDirectoriesFn = setGetSystemDirectoriesFn_
export const setFindCanonicalGitRootFn = setFindCanonicalGitRootFn_
export const setGetAdditionalDirectoriesForClaudeMdFn = setGetAdditionalDirectoriesForClaudeMdFn_
export const setGetUseCoworkPluginsFn = setGetUseCoworkPluginsFn_
export const setResetSentSkillNamesFn = setResetSentSkillNamesFn_
export const setReinitializeLspServerManagerFn = setReinitializeLspServerManagerFn_
export const setWaitForScrollIdleFn = setWaitForScrollIdleFn_
export const setWithDiagnosticsTimingFn = setWithDiagnosticsTimingFn_
export const setGetSecureStorageFn = setGetSecureStorageFn_
export const setUninstallPluginOpFn = setUninstallPluginOpFn_
export const setUpdatePluginOpFn = setUpdatePluginOpFn_
export const setWriteFileSync_DEPRECATEDFn = setWriteFileSync_DEPRECATEDFn_

// ---------------------------------------------------------------------------
// Round-4-extended additions (for services/plugins files): process helpers
// ---------------------------------------------------------------------------

let _writeToStdout: (text: string) => void = text => process.stdout.write(text)
export function writeToStdout(text: string): void {
  _writeToStdout(text)
}
export function setWriteToStdoutFn(fn: typeof _writeToStdout): void {
  _writeToStdout = fn
}

let _gracefulShutdown: (code: number) => Promise<never> = async code => {
  process.exit(code)
}
export function gracefulShutdown(code: number): Promise<never> {
  return _gracefulShutdown(code)
}
export function setGracefulShutdownFn(fn: typeof _gracefulShutdown): void {
  _gracefulShutdown = fn
}
