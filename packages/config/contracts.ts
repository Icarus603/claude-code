export type ConfigHostBindings = {
  getConfigHomeDir?: () => string
  getProjectRoot?: () => string | undefined
  logDebug?: (message: string, metadata?: unknown) => void
  // V7 §8.6 — config cannot import from mcp-runtime (integration layer).
  // The host wires this binding to mcp-runtime's getMcpConfigsByScope at
  // composition time so allErrors.ts can aggregate MCP validation errors
  // without a direct cross-layer dependency.
  getMcpErrorsByScope?: (scope: string) => Array<{
    file?: string
    path: string
    message: string
    source?: string
  }>
  // V7 §8.6 — config cannot import from provider/auth (Wave 3). The host
  // wires this to the full isRemoteManagedSettingsEligible() logic at
  // composition time. Config calls it and caches the boolean.
  checkRemoteSettingsEligibility?: () => boolean
  // V7 §7 — bootstrap state bindings. Config reads these but does not own
  // session-level bootstrap state (that's app-host).
  getIsRemoteMode?: () => boolean
  // V7 §8.6 — lifecycle hook for cleanup on process exit.
  registerCleanup?: (fn: () => Promise<void>) => () => void
  // V7 §8.6 — hook execution bridge. Config cannot import the hooks runtime.
  // Returns true if any hook blocked the change.
  executeConfigChangeHooks?: (source: string) => Promise<{ blocked: boolean }>
  // V7 §8.6 — local-observability bridge for diagnostic logging (MDM telemetry).
  logDiagnostics?: (level: string, event: string, data?: Record<string, unknown>) => void
  // V7 §8.6 — startup profiler bridge (optional, no-op if not installed).
  profileCheckpoint?: (name: string) => void
  // V7 §7 — bootstrap state accessors. Config reads these but does not own
  // session-level state (that's app-host). Added for global/config.ts +
  // settings/settings.ts which need CWD, trust, and flag settings info.
  getCwd?: () => string
  getOriginalCwd?: () => string
  getSessionTrustAccepted?: () => boolean
  getFlagSettingsPath?: () => string | undefined
  getFlagSettingsInline?: () => Record<string, unknown> | null
  getUseCoworkPlugins?: () => boolean
  // V7 §8.6 — event logging bridge (config cannot import eventLogger).
  logEvent?: (event: string, metadata?: Record<string, unknown>) => void
  // V7 §8.6 — git utility bridge (config cannot import git utils).
  findCanonicalGitRoot?: (cwd: string) => string | undefined
  addFileGlobRuleToGitignore?: (dir: string, glob: string) => void
  // V7 §8.6 — global config file path (depends on legacy path detection + OAuth).
  getGlobalClaudeFile?: () => string
  // V7 §8.6 — auth/provider bridge for settings sync + remote settings.
  // Config cannot import auth.ts or providers.ts. Host provides the
  // OAuth token retrieval, API provider check, and token refresh.
  getSettingsSyncAuth?: () => {
    isEligible: boolean
    baseApiUrl: string
    getAuthHeaders: () => Promise<Record<string, string>>
    refreshToken: () => Promise<void>
  } | null
  isInteractive?: () => boolean
  // V7 §8.6 — memory subsystem bridge (config cannot import claudemd).
  clearMemoryFileCaches?: () => void
  // V7 §8.6 — git repo hash for settings sync project ID.
  getRepoRemoteHash?: () => Promise<string | null>
  // V7 §8.6 — fs operations bridge. Config MUST NOT use raw node:fs because
  // the virtual-fs layer (getFsImplementation) is load-bearing for sandbox
  // mode and REPL initialization. Host provides the correct fs facade.
  readFileSync?: (path: string, encoding: string) => string
  writeFileSyncAndFlush?: (path: string, content: string, options?: { encoding?: string; mode?: number }) => void
  statSync?: (path: string) => { mtimeMs: number; size: number }
  existsSync?: (path: string) => boolean
  mkdirSync?: (path: string) => void
  readFileAsync?: (path: string, encoding: string) => Promise<string>
  readdirSync?: (path: string) => Array<{ name: string; isFile(): boolean; isSymbolicLink(): boolean }>
  // V7 §8.6 — lockfile bridge for atomic config writes.
  lockSync?: (file: string, options?: { stale?: number; retries?: unknown }) => () => void
  unlock?: (file: string) => Promise<void>
  // V7 §8.6 — bridge auto-connect default. Feature-gated bridge check.
  isBridgeAutoConnectDefault?: () => boolean
  // V7 §8.6 — settings-change side-effect bridges. Config triggers these
  // when settings change so that permission rules and hooks snapshots stay
  // in sync without config importing from permission or hooks directly.
  loadAllPermissionRulesFromDisk?: () => unknown[]
  updateHooksConfigSnapshot?: () => void
  // V7 §8.24 — security check UI. The React dialog doesn't belong in
  // config (Wave 1 leaf). Host provides the implementation which renders
  // the Ink dialog; config only cares about the result.
  checkManagedSettingsSecurity?: (
    cachedSettings: unknown,
    newSettings: unknown,
  ) => Promise<'approved' | 'rejected' | 'no_check_needed'>
  handleSecurityCheckResult?: (result: 'approved' | 'rejected' | 'no_check_needed') => boolean
  // V7 §11.4 — permission rule parsing bridge (config cannot import permission in Wave 1).
  parsePermissionRule?: (rule: string) => { toolName: string; ruleContent?: string }
  // V7 §11.4 — settings path check bridge.
  isClaudeSettingsPath?: (filePath: string) => boolean
  // V7 §11.4 — permission context reconciliation after settings change.
  // Encapsulates syncPermissionRulesFromDisk + overly-broad filtering +
  // bypass-mode check + plan-auto-mode transition.
  reconcilePermissionContext?: (
    prevContext: unknown,
    updatedRules: unknown[],
  ) => unknown
  // V7 §11.4 — memory auto-entry path bridge.
  getAutoMemEntrypoint?: () => string
}

