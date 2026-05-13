/**
 * policyHelper — external-executable managed-settings provider.
 *
 * Port of ant v2.1.136 `fE_` (0686.js) + `mSH` (0687.js). Lets an
 * enterprise admin ship a binary path through admin-owned settings
 * sources; the CLI spawns it, parses an envelope from stdout, and
 * merges the result into the live managed-settings cache.
 *
 * Envelope shape:
 *   { managedSettings?: object,
 *     claudeMd?: string,
 *     appendSystemPrompt?: string }
 *
 * Critical safety invariants:
 *   - Helper config MAY only come from admin-owned sources
 *     (`plist` / `hklm` / `file`). A user-writable source declaring a
 *     helper would be a sandbox bypass. Enforced by `applyPolicyHelper`
 *     which takes the `source` string and rejects via
 *     ALLOWED_POLICY_HELPER_SOURCES (ant `OZ4`).
 *   - The helper's `managedSettings.policyHelper` is stripped on the
 *     way back so a hostile helper can't recursively re-declare
 *     itself.
 *   - Output cap (ant `nI6 = 1MB`) terminates the child early on
 *     stdout overflow.
 *   - Per-invocation timeout (ant `qZ4 = 10s`) bounded by config
 *     `timeoutMs`.
 *   - Telemetry: `xH('settings_policy_helper', code)` for each
 *     failure, `yH('settings_policy_helper')` on success.
 *
 * Ant identifier map (cross-reference for future bug hunts):
 *   rAq → applyPolicyHelper        — orchestrator (this module's entry)
 *   tAq → invokePolicyHelper       — child-process driver
 *   TZ4 → validateHelperPath
 *   AZ4 → schedulePolicyHelperRefresh (interval re-poll)
 *   OZ4 → ALLOWED_POLICY_HELPER_SOURCES
 *   KZ4 → policyHelperEnvelopeSchema
 *   oI6 → getPolicyHelperManagedSettings
 *   oAq → getPolicyHelperClaudeMd
 *   aAq → getPolicyHelperAppendSystemPrompt
 *   sAq → isPolicyHelperActive
 *   qZ4 → DEFAULT_POLICY_HELPER_TIMEOUT_MS (10s)
 *   nI6 → POLICY_HELPER_OUTPUT_CAP_BYTES (1MB)
 *   dfH → policyHelperState (module-level)
 *   n6_ → refreshTimer
 *   iI6 → refreshInFlight
 */
import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { z } from 'zod/v4'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '@claude-code/local-observability'
import { logForDebugging } from '@claude-code/local-observability/debug.js'

/** Ant `qZ4` — default helper timeout. */
const DEFAULT_POLICY_HELPER_TIMEOUT_MS = 10_000

/** Ant `nI6` — stdout byte cap before forced kill. */
const POLICY_HELPER_OUTPUT_CAP_BYTES = 1_048_576

/**
 * Ant `OZ4` — sources allowed to declare a `policyHelper`. New
 * sources may NOT be added without security review.
 */
export const ALLOWED_POLICY_HELPER_SOURCES = new Set([
  'plist',
  'hklm',
  'file',
])

export type PolicyHelperConfig = {
  path: string
  refreshIntervalMs?: number
  timeoutMs?: number
}

export type PolicyHelperOutput = {
  managedSettings?: Record<string, unknown>
  claudeMd?: string
  appendSystemPrompt?: string
}

/**
 * Ant `KZ4` — envelope shape parsed from helper stdout. Loose object
 * because the helper may emit additional debug fields we ignore.
 */
const policyHelperEnvelopeSchema = z.looseObject({
  managedSettings: z.unknown().optional(),
  claudeMd: z.string().optional(),
  appendSystemPrompt: z.string().optional(),
})

/** Ant failure codes — emitted as the second arg to `xH(scope, code)`. */
export type PolicyHelperFailureCode =
  | 'bad_path'
  | 'bad_source'
  | 'exit_nonzero'
  | 'oversize'
  | 'parse_failed'
  | 'envelope_invalid'
  | 'schema_rejected'
  | 'refresh_failed'

/**
 * Module-level state mirroring ant `dfH`. Holds the last accepted
 * helper output + the config we used to produce it (so the refresh
 * loop can re-invoke with the same args).
 */
type PolicyHelperState = {
  config: PolicyHelperConfig
  output: PolicyHelperOutput
}
let policyHelperState: PolicyHelperState | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null
let refreshInFlight = false
const refreshListeners: Set<() => void> = new Set()

/**
 * Ant `xH('settings_policy_helper', code)` — failure outcome event.
 * Wrapped here so callers don't have to remember the scope tag.
 */
function logFailure(
  code: PolicyHelperFailureCode,
  extra: Record<string, unknown> = {},
): void {
  logEvent('settings_policy_helper', {
    failure_code:
      code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...extra,
  })
}

/**
 * Ant `yH('settings_policy_helper')` — success outcome event.
 */
function logSuccess(extra: Record<string, unknown> = {}): void {
  logEvent('settings_policy_helper_success', {
    ...extra,
  })
}

/**
 * Ant `TZ4`. Validate a helper-binary path. Returns null on success
 * or a human-readable error string on failure. Returning the message
 * (not throwing) matches ant's contract — the caller turns it into
 * a `xH('bad_path')` failure with the message embedded.
 */
export function validateHelperPath(path: string): string | null {
  if (!path || path.length === 0) {
    return 'path must be non-empty'
  }
  if (!isAbsolute(path)) {
    return `path must be absolute: ${path}`
  }
  if (process.platform === 'win32' && !/\.exe$/i.test(path)) {
    return `path must end in .exe on Windows: ${path}`
  }
  return null
}

/**
 * Ant `OZ4.has(source)`. Returns true when the named settings source
 * is allowed to declare a `policyHelper`. Null source (no provenance)
 * is rejected — only admin-controlled sources may install a helper.
 */
export function isAdminPolicySource(source: string | null | undefined): boolean {
  if (source === null || source === undefined) return false
  return ALLOWED_POLICY_HELPER_SOURCES.has(source)
}

/**
 * Ant `tAq`. Invoke the helper binary once and parse its output.
 * Returns either `{output}` on success or `{error, code}` on failure.
 * The caller (ant `rAq` / our `applyPolicyHelper`) is responsible for
 * persisting the result and firing the matching telemetry.
 */
export async function invokePolicyHelper(
  config: PolicyHelperConfig,
): Promise<
  | { output: PolicyHelperOutput }
  | { error: string; code: PolicyHelperFailureCode }
> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_POLICY_HELPER_TIMEOUT_MS
  // Ant `f8(H.path, [], { timeout: _, maxBuffer: nI6+1, ... })` returns
  // `{stdout, stderr, code, error}` with stdout being the COMPLETE
  // payload up to maxBuffer. We mirror with a spawn loop that
  // accumulates chunks as Buffers (NOT strings) and measures bytes via
  // `Buffer.byteLength` — critical: the old impl used
  // `stdout.length + chunk.length` mixing JS string code-unit count and
  // Buffer byte count, which silently underflows for UTF-8 multi-byte
  // text and lets the helper exceed the cap.
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  let stdoutBytes = 0
  let oversized = false
  return await new Promise<
    | { output: PolicyHelperOutput }
    | { error: string; code: PolicyHelperFailureCode }
  >(resolve => {
    let child
    try {
      child = spawn(config.path, [], {
        env: {
          ...process.env,
          // Ant ships `CLAUDE_CODE_VERSION` from the build-time const.
          // ccb mirrors via the `CLAUDE_CODE_VERSION` env so the helper
          // sees the version that invoked it.
          CLAUDE_CODE_VERSION: process.env.CLAUDE_CODE_VERSION ?? 'dev',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      resolve({
        error: `spawn failed: ${(e as Error).message}`,
        code: 'exit_nonzero',
      })
      return
    }
    const t = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        // already exited
      }
    }, timeoutMs)
    t.unref?.()
    child.stdout?.on('data', (chunk: Buffer) => {
      // Accept the chunk first, THEN check the cap and bail. ant's
      // `f8(maxBuffer: nI6+1)` semantically keeps up to `nI6+1` bytes
      // and then the close handler does `byteLength > nI6` — that one
      // extra byte is how it discriminates "exactly at cap" from
      // "over cap". Mirror by stopping the read at the same boundary.
      stdoutChunks.push(chunk)
      stdoutBytes += chunk.length
      if (stdoutBytes > POLICY_HELPER_OUTPUT_CAP_BYTES) {
        oversized = true
        try {
          child.kill('SIGTERM')
        } catch {
          // already exited
        }
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })
    child.on('close', code => {
      clearTimeout(t)
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8')
      const stderr = Buffer.concat(stderrChunks).toString('utf-8')
      // Ant logs stderr regardless of success/failure with debug level.
      if (stderr) {
        logForDebugging(`policyHelper stderr: ${stderr}`)
      }
      if (oversized) {
        resolve({
          error: `stdout exceeded ${POLICY_HELPER_OUTPUT_CAP_BYTES} bytes`,
          code: 'oversize',
        })
        return
      }
      if (code !== 0) {
        resolve({
          error: `exited with code ${code}: ${stderr || stdout || ''}`,
          code: 'exit_nonzero',
        })
        return
      }
      // Ant double-checks the byte cap on close (defends against
      // maxBuffer=nI6+1 letting one byte slip through).
      if (Buffer.byteLength(stdout, 'utf-8') > POLICY_HELPER_OUTPUT_CAP_BYTES) {
        resolve({
          error: `stdout exceeded ${POLICY_HELPER_OUTPUT_CAP_BYTES} bytes`,
          code: 'oversize',
        })
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(stdout)
      } catch {
        resolve({
          error: 'stdout is not valid JSON',
          code: 'parse_failed',
        })
        return
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        resolve({
          error: 'stdout is not a JSON object',
          code: 'parse_failed',
        })
        return
      }
      const result = policyHelperEnvelopeSchema.safeParse(parsed)
      if (!result.success) {
        resolve({
          error: `invalid envelope: ${result.error.message}`,
          code: 'envelope_invalid',
        })
        return
      }
      // Build typed output. ant strips `policyHelper` out of the
      // returned `managedSettings` so the helper can't recursively
      // re-declare itself; we do the same. Ant additionally clones
      // (`NV` = structuredClone) the helper's managedSettings before
      // stripping, so mutations to our return value can't bleed back
      // into the parsed envelope. We deep-copy via JSON since we just
      // parsed from JSON and know it's plain-JSON-safe.
      const output: PolicyHelperOutput = {}
      const ms = result.data.managedSettings
      if (ms !== undefined) {
        if (!ms || typeof ms !== 'object' || Array.isArray(ms)) {
          resolve({
            error: 'managedSettings must be an object',
            code: 'schema_rejected',
          })
          return
        }
        const cloned = JSON.parse(JSON.stringify(ms)) as Record<string, unknown>
        const { policyHelper: _strip, ...rest } = cloned
        void _strip
        output.managedSettings = rest
      }
      if (result.data.claudeMd !== undefined) {
        output.claudeMd = result.data.claudeMd
      }
      if (result.data.appendSystemPrompt !== undefined) {
        output.appendSystemPrompt = result.data.appendSystemPrompt
      }
      resolve({ output })
    })
    child.on('error', err => {
      clearTimeout(t)
      resolve({
        error: `spawn error: ${err.message}`,
        code: 'exit_nonzero',
      })
    })
  })
}

/**
 * Ant `rAq`. Orchestrator: takes the merged settings + the source
 * they came from, validates the source is admin-controlled, runs
 * `validateHelperPath`, spawns the helper, persists the result to
 * module-level state, sets up the refresh interval, and returns null
 * on success or an error string suitable for displaying to the user.
 *
 * The caller (mdm/settings loader) decides whether to surface the
 * error.
 */
export async function applyPolicyHelper(
  settings: { policyHelper?: unknown } | null | undefined,
  source: string | null | undefined,
): Promise<string | null> {
  const cfg = settings?.policyHelper as PolicyHelperConfig | undefined
  if (!cfg) return null
  if (!isAdminPolicySource(source)) {
    logFailure('bad_source', {
      source:
        (source ??
          'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    logForDebugging(
      `policyHelper ignored: delivered via non-admin source '${source ?? 'unknown'}'`,
    )
    return null
  }
  const pathError = validateHelperPath(cfg.path)
  if (pathError) {
    logFailure('bad_path')
    return `policyHelper failed: ${pathError}`
  }
  const result = await invokePolicyHelper(cfg)
  if ('error' in result) {
    logFailure(result.code)
    return `policyHelper failed: ${result.error}`
  }
  policyHelperState = { config: cfg, output: result.output }
  logSuccess()
  schedulePolicyHelperRefresh(cfg)
  logForDebugging(
    `policyHelper applied (keys: ${Object.keys(result.output).join(',')})`,
  )
  return null
}

/**
 * Ant `AZ4`. Set up a setInterval that re-invokes the helper every
 * `refreshIntervalMs`. Re-entrance is guarded by `refreshInFlight`
 * so a slow helper doesn't stack up overlapping invocations. The
 * timer is `.unref()`'d so it never keeps Node alive on its own.
 */
function schedulePolicyHelperRefresh(config: PolicyHelperConfig): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  const intervalMs = config.refreshIntervalMs ?? 0
  if (intervalMs <= 0) return
  refreshTimer = setInterval(() => {
    if (refreshInFlight) return
    refreshInFlight = true
    void invokePolicyHelper(config)
      .then(r => {
        if ('error' in r) {
          logFailure('refresh_failed', {
            error_code:
              r.code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          return
        }
        if (policyHelperState) {
          policyHelperState = { ...policyHelperState, output: r.output }
          for (const fn of refreshListeners) {
            try {
              fn()
            } catch {
              // listener exception shouldn't break the refresh loop
            }
          }
        }
      })
      .finally(() => {
        refreshInFlight = false
      })
  }, intervalMs)
  refreshTimer.unref?.()
}

/** Test-only: stop the refresh timer (so the test process exits). */
export function stopPolicyHelperRefreshForTesting(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  refreshInFlight = false
}

/**
 * Subscribe to refresh events. Returns an unsubscribe function. ant
 * fires `uSH.emit("policySettings")` + `rI6.emit()` — listeners here
 * cover the same need (notify consumers that managedSettings may
 * have changed).
 */
export function onPolicyHelperRefresh(listener: () => void): () => void {
  refreshListeners.add(listener)
  return () => {
    refreshListeners.delete(listener)
  }
}

/** Ant `oI6`. */
export function getPolicyHelperManagedSettings():
  | Record<string, unknown>
  | null {
  return policyHelperState?.output.managedSettings ?? null
}

/** Ant `oAq`. */
export function getPolicyHelperClaudeMd(): string | null {
  return policyHelperState?.output.claudeMd ?? null
}

/** Ant `aAq`. */
export function getPolicyHelperAppendSystemPrompt(): string | null {
  return policyHelperState?.output.appendSystemPrompt ?? null
}

/** Ant `sAq`. */
export function isPolicyHelperActive(): boolean {
  return policyHelperState !== null
}

/**
 * Test-only: clear module-level state.
 */
export function _resetPolicyHelperForTesting(): void {
  policyHelperState = null
  stopPolicyHelperRefreshForTesting()
  refreshListeners.clear()
}
