/**
 */

export interface ShellExecContext {
  getCwd(): string
  setCwd(path: string): void
  getOriginalCwd(): string

  getSessionId(): string

  logEvent(name: string, data: Record<string, unknown>): void
  logForDebugging(msg: string): void

  getSessionEnvVars(): Iterable<[string, string]>
  getSessionEnvironmentScript(): Promise<string>

  wrapWithSandbox?(
    cmd: string,
    shell: string,
    tmpDir: string | undefined,
    signal: AbortSignal,
  ): Promise<string>
  cleanupAfterSandbox?(): void

  onCwdChanged?(oldCwd: string, newCwd: string): Promise<void>

  getTmuxEnv?(command: string): Promise<string | null>
  ensureTmuxSocket?(): Promise<void>
  hasTmuxToolBeenUsed?(): boolean

  registerUpstreamProxyEnvFn?(fn: () => Record<string, string>): void
  getUpstreamProxyEnv?(): Record<string, string>

  getPlatform(): 'macos' | 'linux' | 'windows'
  which(command: string): Promise<string | null>

  invalidateSessionEnvCache?(): void

  getTaskOutputDir(): string
  generateTaskId(prefix: string): string
  getMaxTaskOutputBytes(): number

  getSandboxTmpDirName?(): string
}

/**
 */
export interface SnapshotContext {
  logEvent(name: string, data: Record<string, unknown>): void
  logForDebugging(msg: string): void
  logError(error: unknown): void

  getPlatform(): 'macos' | 'linux' | 'windows'

  // ─── CWD ──────────────────────────────────────────────────────
  getCwd(): string

  getClaudeConfigHomeDir(): string

  pathExists(path: string): Promise<boolean>
  getFs(): {
    unlink(path: string): Promise<void>
    readdir(path: string): Promise<string[]>
  }

  registerCleanup(fn: () => Promise<void>): void

  hasEmbeddedSearchTools(): boolean
  embeddedSearchToolsBinaryPath(): string

  // ─── Ripgrep ─────────────────────────────────────────────────
  ripgrepCommand(): {
    rgPath: string
    rgArgs: string[]
    argv0?: string
  }

  subprocessEnv(): Record<string, string | undefined>
}
