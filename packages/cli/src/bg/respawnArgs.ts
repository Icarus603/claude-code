/**
 * Reconstruct a `(flags, directive)` pair from a stored job meta.cmd.
 *
 * Two cmd shapes (both pre-stripped of bg flags by splitBgArgs):
 *   detached: [interpreter, cli.js?, ...userFlags, '-p', directive]
 *   pty:      [interpreter, cli.js?, '--bg-pty-host', sock, cols, rows,
 *              '--', interpreter, cli.js?, ...userFlags, directive]
 *
 * Detached uses `-p directive` so the marker is unambiguous. Pty uses
 * the directive as a positional (REPL prompt-arg) so we extract the
 * LAST non-flag arg from the inner-ccb tail.
 */
export function extractRespawnArgs(cmd: readonly string[]): {
  flags: string[]
  directive: string
} | null {
  let i = cmd[0]?.endsWith('bun') ? 2 : 1
  let isPty = false
  if (cmd[i] === '--bg-pty-host') {
    isPty = true
    const dashDash = cmd.indexOf('--', i)
    if (dashDash < 0) return null
    i = dashDash + 1
    if (i < cmd.length && cmd[i]?.endsWith('bun')) i += 2
    else i += 1
  }

  if (!isPty) {
    // detached: -p marker
    const pIdx = cmd.lastIndexOf('-p')
    if (pIdx < i || pIdx === cmd.length - 1) return null
    return {
      flags: [...cmd.slice(i, pIdx)],
      directive: cmd.slice(pIdx + 1).join(' '),
    }
  }

  // pty: scan inner args, separating flags+values from positional.
  // Reuse splitBgArgs's flag-with-value table: flags like --model
  // consume the next arg as their value rather than treating it as a
  // positional.
  const inner = cmd.slice(i)
  return parseInnerArgs(inner)
}

/**
 * Same flag-detection rules as bg/argParse.ts splitBgArgs, minus the
 * --bg-* prefix stripping (those don't appear in stored cmds).
 */
function parseInnerArgs(args: readonly string[]): {
  flags: string[]
  directive: string
} | null {
  const FLAGS_WITH_VALUE = new Set([
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
  const dashDashIdx = args.indexOf('--')
  const before = dashDashIdx >= 0 ? args.slice(0, dashDashIdx) : args
  const after = dashDashIdx >= 0 ? args.slice(dashDashIdx + 1) : []
  const flags: string[] = []
  const positionals: string[] = []
  for (let k = 0; k < before.length; k++) {
    const a = before[k]!
    if (a.startsWith('-')) {
      flags.push(a)
      if (a.includes('=')) continue
      const next = before[k + 1]
      if (next !== undefined && !next.startsWith('-') && FLAGS_WITH_VALUE.has(a)) {
        flags.push(next)
        k++
      }
      continue
    }
    positionals.push(a)
  }
  const directive = [...positionals, ...after].join(' ')
  if (!directive) return null
  return { flags, directive }
}
