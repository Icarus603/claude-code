/**
 * Argv parsing for `ccb --bg <directive>` — split flags from the
 * directive positional so spawned bg children get their flags
 * forwarded intact.
 *
 * Extracted from bg.ts for the file-size budget. Consumed by
 * `bg.ts:handleBgFlag` and exercised directly by unit tests.
 *
 * Mirrors ant 4649.js Kf3 (lastPositional) + VJK (flagsWithoutPositional)
 * + RJK (stdin embed) collapsed into one pass.
 *
 * @dynamicRequire
 */

/**
 * Flags that take a separate value argument: `--flag value` form.
 * Approximation of ant 4649.js RC8. We don't need to enumerate every
 * single ccb flag — we just need enough coverage that the directive
 * extractor doesn't accidentally consume `<value>` as a positional.
 * If we miss one, the worst-case is the user gets a confusing error,
 * not a silent corruption.
 */
const BG_FLAGS_WITH_VALUE = new Set([
  '--model',
  '--permission-mode',
  '--session-id',
  '--add-dir',
  '-r',
  '--resume',
  '--max-turns',
  '--cwd',
  '--debug-file',
  '--mcp-config',
  '--append-system-prompt',
  '--strict-mcp-config',
  '--include-partial-messages',
])

/**
 * Split argv into (flags-to-forward, directive). The directive is the
 * last positional (or stdin if no positional), with everything after a
 * `--` separator joined into the same positional. Flags before/after
 * the directive are forwarded to the spawned child unchanged so users
 * can do `ccb --bg --model claude-haiku-4-5 "summarize this"`.
 *
 * Exported for unit-test coverage.
 *
 * @dynamicRequire
 */
export function splitBgArgs(args: readonly string[]): {
  flags: string[]
  directive: string
} {
  // Honor `--`: anything after it is treated as positional content, even
  // if it looks like a flag.
  const dashDashIdx = args.indexOf('--')
  const beforeDashDash = dashDashIdx >= 0 ? args.slice(0, dashDashIdx) : args
  const afterDashDash = dashDashIdx >= 0 ? args.slice(dashDashIdx + 1) : []

  const flags: string[] = []
  const positionals: string[] = []
  for (let i = 0; i < beforeDashDash.length; i++) {
    const a = beforeDashDash[i]!
    if (
      a === '--bg' ||
      a === '--background' ||
      a === '-bg' ||
      a === '--bg-pty' ||
      a === '--bg-interactive'
    ) {
      continue
    }
    if (a.startsWith('-')) {
      flags.push(a)
      // `--flag=value` form is self-contained; `--flag value` form
      // requires consuming the next arg if it's in our known list.
      if (a.includes('=')) continue
      const next = beforeDashDash[i + 1]
      if (
        next !== undefined &&
        !next.startsWith('-') &&
        BG_FLAGS_WITH_VALUE.has(a)
      ) {
        flags.push(next)
        i++
      }
      continue
    }
    positionals.push(a)
  }

  const directive = [...positionals, ...afterDashDash].join(' ').trim()
  return { flags, directive }
}
