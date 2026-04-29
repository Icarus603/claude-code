import {
  type ExecSyncOptions,
  type ExecSyncOptionsWithBufferEncoding,
  type ExecSyncOptionsWithStringEncoding,
  execSync as nodeExecSync,
} from 'child_process'
import { slowLogging } from '@claude-code/local-observability/slowOperations.js'

/**
 * Wrapped execSync with slow-operation logging.
 * Use this instead of child_process execSync directly to detect performance issues.
 *
 * @todo Migrate callers to async alternatives where possible. Sync exec
 * blocks the event loop; the async path lives in `execFileNoThrow`.
 *
 * @example
 * import { execSync } from './execSyncWrapper.js'
 * const result = execSync('git status', { encoding: 'utf8' })
 */
export function execSync(command: string): Buffer
export function execSync(
  command: string,
  options: ExecSyncOptionsWithStringEncoding,
): string
export function execSync(
  command: string,
  options: ExecSyncOptionsWithBufferEncoding,
): Buffer
export function execSync(
  command: string,
  options?: ExecSyncOptions,
): Buffer | string
export function execSync(
  command: string,
  options?: ExecSyncOptions,
): Buffer | string {
  using _ = slowLogging`execSync: ${command.slice(0, 100)}`
  return nodeExecSync(command, options)
}
