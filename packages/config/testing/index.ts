/**
 * @claude-code/config/testing
 *
 * V7 §9.11 — in-memory fake for the config package.
 *
 * InMemoryConfig : provides a `ConfigHostBindings` implementation that
 *                  operates entirely in memory — no real filesystem, no
 *                  OAuth, no external services. Useful in unit tests that
 *                  exercise config-dependent code without a full host setup.
 *
 * Must NOT import from ../internal/ (V7 §9.11 hard rule).
 */

import type { ConfigHostBindings } from '../contracts.js'

export type { ConfigHostBindings }

// ---------------------------------------------------------------------------
// InMemoryConfig
// ---------------------------------------------------------------------------

export type InMemoryConfigOptions = {
  /** Simulated config home directory path. Defaults to '/test-config-home'. */
  configHomeDir?: string
  /** Simulated project root. Defaults to undefined (no project). */
  projectRoot?: string
  /** Simulated CWD. Defaults to '/test-cwd'. */
  cwd?: string
  /** Whether to simulate interactive mode. Defaults to false. */
  interactive?: boolean
  /** Initial in-memory file contents, keyed by absolute path. */
  files?: Record<string, string>
}

/**
 * InMemoryConfig — an in-memory `ConfigHostBindings` implementation.
 *
 * All filesystem-backed operations (read, write, stat, mkdir, readdir …)
 * operate on a `Map<string, string>` rather than the real filesystem, making
 * tests hermetic and fast.
 *
 * ```ts
 * const cfg = new InMemoryConfig({ configHomeDir: '/home/test' })
 * installConfigHostBindings(cfg.bindings)
 * // … test code that calls getGlobalConfig(), saveGlobalConfig() …
 * ```
 */
export class InMemoryConfig {
  private readonly _fs = new Map<string, string>()
  private readonly _dirs = new Set<string>()
  private readonly _opts: Required<InMemoryConfigOptions>

  constructor(options: InMemoryConfigOptions = {}) {
    this._opts = {
      configHomeDir: options.configHomeDir ?? '/test-config-home',
      projectRoot: options.projectRoot ?? undefined as unknown as string,
      cwd: options.cwd ?? '/test-cwd',
      interactive: options.interactive ?? false,
      files: options.files ?? {},
    }

    // Pre-populate in-memory fs with provided files.
    for (const [path, content] of Object.entries(this._opts.files)) {
      this._fs.set(path, content)
    }
  }

  /** Read the current in-memory content of a file (undefined if missing). */
  readMemoryFile(path: string): string | undefined {
    return this._fs.get(path)
  }

  /** Directly write to the in-memory filesystem (for test setup). */
  writeMemoryFile(path: string, content: string): void {
    this._fs.set(path, content)
  }

  /** The `ConfigHostBindings` object to pass to `installConfigHostBindings()`. */
  readonly bindings: ConfigHostBindings = {
    getConfigHomeDir: () => this._opts.configHomeDir,
    getProjectRoot: () => this._opts.projectRoot,
    getCwd: () => this._opts.cwd,
    getOriginalCwd: () => this._opts.cwd,
    isInteractive: () => this._opts.interactive,

    // Stub-only bindings — return safe no-op values for test isolation.
    getSessionTrustAccepted: () => true,
    getFlagSettingsPath: () => undefined,
    getFlagSettingsInline: () => null,
    getUseCoworkPlugins: () => false,
    getIsRemoteMode: () => false,
    isBridgeAutoConnectDefault: () => false,
    checkRemoteSettingsEligibility: () => false,

    // In-memory filesystem shims.
    readFileSync: (path: string, _encoding: string): string => {
      const content = this._fs.get(path)
      if (content === undefined) {
        const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      }
      return content
    },

    writeFileSyncAndFlush: (path: string, content: string): void => {
      this._fs.set(path, content)
    },

    statSync: (path: string): { mtimeMs: number; size: number } => {
      const content = this._fs.get(path)
      if (content === undefined) {
        const err = new Error(`ENOENT: no such file or directory, stat '${path}'`) as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      }
      return { mtimeMs: 0, size: content.length }
    },

    existsSync: (path: string): boolean => {
      return this._fs.has(path) || this._dirs.has(path)
    },

    mkdirSync: (path: string): void => {
      this._dirs.add(path)
    },

    readFileAsync: async (path: string, _encoding: string): Promise<string> => {
      const content = this._fs.get(path)
      if (content === undefined) {
        const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      }
      return content
    },

    readdirSync: (path: string): Array<{ name: string; isFile(): boolean; isSymbolicLink(): boolean }> => {
      const prefix = path.endsWith('/') ? path : `${path}/`
      const entries: Array<{ name: string; isFile(): boolean; isSymbolicLink(): boolean }> = []
      for (const key of this._fs.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length)
          if (!rest.includes('/')) {
            entries.push({
              name: rest,
              isFile: () => true,
              isSymbolicLink: () => false,
            })
          }
        }
      }
      return entries
    },

    // No-op lifecycle hooks — tests rarely need these.
    registerCleanup: (_fn) => () => {},
    logEvent: () => {},
    logDebug: () => {},
    logDiagnostics: () => {},
    profileCheckpoint: () => {},
    clearMemoryFileCaches: () => {},
    getGlobalClaudeFile: () => `${this._opts.configHomeDir}/.claude.json`,

    // Async no-ops.
    executeConfigChangeHooks: async () => ({ blocked: false }),
    getMcpErrorsByScope: () => [],
    findCanonicalGitRoot: () => undefined,
    addFileGlobRuleToGitignore: () => {},
    getRepoRemoteHash: async () => null,
    getSettingsSyncAuth: () => null,
    unlock: async () => {},

    // Managed settings security — always approve in tests.
    checkManagedSettingsSecurity: async () => 'no_check_needed',
    handleSecurityCheckResult: () => true,

    // V7 §11.4 — Wave 1 testing stubs for permission/memory bridges.
    parsePermissionRule: (rule: string) => {
      const idx = rule.indexOf('(')
      if (idx === -1) return { toolName: rule }
      return { toolName: rule.substring(0, idx), ruleContent: rule.substring(idx + 1, rule.length - 1) }
    },
    isClaudeSettingsPath: () => false,
    reconcilePermissionContext: (prev: unknown) => prev,
    getAutoMemEntrypoint: () => '/test-config-home/memory/auto.md',
  }
}
