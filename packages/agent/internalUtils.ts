/**
 * Pure utility functions for the agent package.
 *
 * These replace direct imports from app-compat that violate V7 boundaries.
 * All functions here are self-contained — no cross-boundary deps.
 *
 * V7 §8 — agent cannot import from app-compat. Local implementations are
 * the approved substitution pattern for pure utilities.
 */

// ── Error utilities ────────────────────────────────────────────────────────────

/** Extract a string message from an unknown error-like value. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Extract the errno code (e.g. 'ENOENT', 'EACCES') from a caught error. */
export function getErrnoCode(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as Record<string, unknown>).code === 'string') {
    return (e as Record<string, string>).code
  }
  return undefined
}

/** True if the error is ENOENT (file or directory does not exist). */
export function isENOENT(e: unknown): boolean {
  return getErrnoCode(e) === 'ENOENT'
}

/**
 * True if the error means the path is missing, inaccessible, or unreachable.
 * Covers ENOENT, EACCES, EPERM, ENOTDIR, ELOOP.
 */
export function isFsInaccessible(e: unknown): boolean {
  const code = getErrnoCode(e)
  return (
    code === 'ENOENT' ||
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'ENOTDIR' ||
    code === 'ELOOP'
  )
}

// ── Environment utilities ─────────────────────────────────────────────────────

export function isEnvTruthy(envVar: string | boolean | undefined): boolean {
  if (!envVar) return false
  if (typeof envVar === 'boolean') return envVar
  const normalizedValue = envVar.toLowerCase().trim()
  return ['1', 'true', 'yes', 'on'].includes(normalizedValue)
}

export function isEnvDefinedFalsy(envVar: string | boolean | undefined): boolean {
  if (envVar === undefined) return false
  if (typeof envVar === 'boolean') return !envVar
  if (!envVar) return false
  const normalizedValue = envVar.toLowerCase().trim()
  return ['0', 'false', 'no', 'off'].includes(normalizedValue)
}

/**
 * --bare / CLAUDE_CODE_SIMPLE: skip hooks, background prefetches,
 * and credential reads.
 */
export function isBareMode(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE) ||
    process.argv.includes('--bare')
  )
}

// ── Filesystem utilities ───────────────────────────────────────────────────────

import { stat } from 'fs/promises'

/** Check if a path exists (async, swallows errors). */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

// ── JSON utilities ─────────────────────────────────────────────────────────────

/**
 * Safely parse JSON. Returns null on invalid/empty input (never throws).
 * `shouldLogError` is accepted for API compatibility but errors are silently swallowed.
 */
export function safeParseJSON(json: string | null | undefined, _shouldLogError?: boolean): unknown {
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

/** JSON.stringify wrapper — functionally equivalent, without slow-op telemetry. */
export function jsonStringify(
  value: unknown,
  replacer?: ((this: unknown, key: string, value: unknown) => unknown) | (number | string)[] | null,
  space?: string | number,
): string {
  return JSON.stringify(value, replacer as Parameters<typeof JSON.stringify>[1], space)
}

// ── Schema utilities ───────────────────────────────────────────────────────────

/** Lazy singleton factory — evaluates `factory` once on first call. */
export function lazySchema<T>(factory: () => T): () => T {
  let cached: T | undefined
  return () => (cached ??= factory())
}

// ── Array utilities ────────────────────────────────────────────────────────────

/** Count elements in `arr` satisfying `pred`. */
export function count<T>(arr: T[], pred: (item: T) => boolean): number {
  let n = 0
  for (const item of arr) {
    if (pred(item)) n++
  }
  return n
}
