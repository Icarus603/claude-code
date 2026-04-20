/**
 * Turn-scoped workload tag via AsyncLocalStorage.
 *
 * AsyncLocalStorage module-level singleton — must not be duplicated or
 * imported from the browser bundle (which can't load async_hooks).
 */

import { AsyncLocalStorage } from 'async_hooks'

/**
 * Server-side sanitizer (_sanitize_entrypoint in claude_code.py) accepts
 * only lowercase [a-z0-9_-]{0,32}. Uppercase stops parsing at char 0.
 */
export type Workload = 'cron'
export const WORKLOAD_CRON: Workload = 'cron'

const workloadStorage = new AsyncLocalStorage<{
  workload: string | undefined
}>()

export function getWorkload(): string | undefined {
  return workloadStorage.getStore()?.workload
}

/**
 * Wrap `fn` in a workload ALS context. ALWAYS establishes a new context
 * boundary, even when `workload` is undefined.
 *
 * Always calling `.run()` guarantees `getWorkload()` inside `fn` returns
 * exactly what the caller passed — including `undefined`.
 */
export function runWithWorkload<T>(
  workload: string | undefined,
  fn: () => T,
): T {
  return workloadStorage.run({ workload }, fn)
}
