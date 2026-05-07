/**
 * Pure utility helpers for the bg.ts job machinery — extracted to keep
 * the host file under the 800-LOC budget.
 */

// Re-export the canonical liveness probe from shell so callers don't
// have to know which package it lives in. The bg path historically
// named this `isProcessRunning` but its semantics match `isPidAlive`
// (EPERM → still alive). Re-export under both names so callers don't
// have to migrate their import sites en-masse.
export { isPidAlive as isProcessRunning } from '@claude-code/shell/genericProcessUtils.js'

/** Format ms-timestamp delta as a humane "Xs/m/h/d ago" string. */
export function formatRelativeTime(ms: number): string {
  const delta = Math.max(0, Date.now() - ms)
  const seconds = Math.floor(delta / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/** Truncate a string to N visible chars, suffixing `…` if cut. */
export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
