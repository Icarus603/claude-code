/**
 * ant v2.1.139 0130.js:30 (Zo8) — read CLAUDE_CODE_MAX_TURNS env when the CLI
 * `--max-turns` flag is not set. Lets headless / SDK callers cap a runaway
 * agent without rebuilding the CLI invocation.
 *
 * Throws if the env var is set to a non-positive-integer value so the caller
 * doesn't silently get unbounded behavior on typo.
 */
export function resolveMaxTurnsFromEnv(
  explicit: number | undefined,
): number | undefined {
  if (explicit !== undefined) return explicit
  const raw = process.env.CLAUDE_CODE_MAX_TURNS?.trim()
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `CLAUDE_CODE_MAX_TURNS must be a positive integer; got "${raw}"`,
    )
  }
  return n
}
