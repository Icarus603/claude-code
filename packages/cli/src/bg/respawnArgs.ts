/**
 * Reconstruct a `(flags, directive)` pair from a stored job meta.cmd.
 *
 * Two cmd shapes:
 *   detached: [interpreter, optional-cli.js, ...userFlags, '-p', directive]
 *   pty:      [interpreter, optional-cli.js, '--bg-pty-host', sock, cols, rows,
 *              '--', interpreter, optional-cli.js, ...userFlags, '-p', directive]
 *
 * For pty cmds we unwrap the host prefix so respawn re-feeds clean
 * inner args. Detection: if the second arg (post-interpreter) is
 * '--bg-pty-host', skip ahead through the `--` separator.
 *
 * Used by `ccb respawn`. Pure — no filesystem deps — so the test suite
 * exercises edge cases without spinning up a real bg job.
 *
 * @dynamicRequire
 */
export function extractRespawnArgs(cmd: readonly string[]): {
  flags: string[]
  directive: string
} | null {
  // Drop interpreter prefix (cmd[0]) and, if it ends in 'bun', also cmd[1].
  let i = cmd[0]?.endsWith('bun') ? 2 : 1
  // Detect pty wrapper: skip --bg-pty-host <sock> <cols> <rows> -- <interp>...
  if (cmd[i] === '--bg-pty-host') {
    const dashDash = cmd.indexOf('--', i)
    if (dashDash < 0) return null
    i = dashDash + 1
    // Skip the inner interpreter prefix too.
    if (i < cmd.length && cmd[i]?.endsWith('bun')) i += 2
    else i += 1
  }
  // Find the last '-p' marker; everything after is the directive.
  const pIdx = cmd.lastIndexOf('-p')
  if (pIdx < i || pIdx === cmd.length - 1) return null
  const flags = cmd.slice(i, pIdx)
  const directive = cmd.slice(pIdx + 1).join(' ')
  return { flags: [...flags], directive }
}
