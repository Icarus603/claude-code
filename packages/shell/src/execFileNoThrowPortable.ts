import { type Options as ExecaOptions, execaSync } from 'execa'
import { getCwd } from '@claude-code/app-host/bootstrap/cwd.js'
import { slowLogging } from '@claude-code/local-observability/slowOperations.js'

const MS_IN_SECOND = 1000
const SECONDS_IN_MINUTE = 60

type ExecSyncOptions = {
  abortSignal?: AbortSignal
  timeout?: number
  input?: string
  stdio?: ExecaOptions['stdio']
}

/**
 * @todo Migrate callers to `execa` directly with `{ shell: true, reject: false }`
 * for non-blocking execution. Sync exec blocks the event loop.
 */
export function execSyncWithDefaults(command: string): string | null
/**
 * @todo Migrate callers to `execa` directly with `{ shell: true, reject: false }`
 * for non-blocking execution. Sync exec blocks the event loop.
 */
export function execSyncWithDefaults(
  command: string,
  options: ExecSyncOptions,
): string | null
/**
 * @todo Migrate callers to `execa` directly with `{ shell: true, reject: false }`
 * for non-blocking execution. Sync exec blocks the event loop.
 */
export function execSyncWithDefaults(
  command: string,
  abortSignal: AbortSignal,
  timeout?: number,
): string | null
/**
 * @todo Migrate callers to `execa` directly with `{ shell: true, reject: false }`
 * for non-blocking execution. Sync exec blocks the event loop.
 */
export function execSyncWithDefaults(
  command: string,
  optionsOrAbortSignal?: ExecSyncOptions | AbortSignal,
  timeout = 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
): string | null {
  let options: ExecSyncOptions

  if (optionsOrAbortSignal === undefined) {
    options = {}
  } else if (optionsOrAbortSignal instanceof AbortSignal) {
    options = {
      abortSignal: optionsOrAbortSignal,
      timeout,
    }
  } else {
    options = optionsOrAbortSignal
  }

  const {
    abortSignal,
    timeout: finalTimeout = 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
    input,
    stdio = ['ignore', 'pipe', 'pipe'],
  } = options

  abortSignal?.throwIfAborted()
  using _ = slowLogging`exec: ${command.slice(0, 200)}`
  try {
    // execa's overloads don't model `shell: true` + single command-line
    // string; we pass the full command string and let execa shell-parse.
    // This cast bridges the overload mismatch.
    const result = (execaSync as (cmd: string, options: ExecaOptions) => {
      stdout: string | Buffer
      stderr: string | Buffer
      exitCode?: number
    })(command, {
      env: process.env,
      maxBuffer: 1_000_000,
      timeout: finalTimeout,
      cwd: getCwd(),
      stdio,
      shell: true,
      reject: false,
      input,
    })
    if (!result.stdout) {
      return null
    }
    return result.stdout.trim() || null
  } catch {
    return null
  }
}
