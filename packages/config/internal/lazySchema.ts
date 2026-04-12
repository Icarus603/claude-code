/**
 * Returns a memoized factory function that constructs the value on first call.
 * Used to defer Zod schema construction from module init time to first access.
 *
 * V7 §11.4 — kept package-internal (not in a shared utils package). Each owner
 * that needs this 8-line helper duplicates it; the cost is negligible compared
 * to the cost of a shared utility package becoming the next God dependency.
 */
export function lazySchema<T>(factory: () => T): () => T {
  let cached: T | undefined
  return () => (cached ??= factory())
}
