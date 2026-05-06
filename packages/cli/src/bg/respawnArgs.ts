/**
 * Reconstruct a `(flags, directive)` pair from a stored job meta.cmd.
 *
 * Used by `ccb respawn` to re-launch a backgrounded job with the same
 * directive and flags as the original. Pure function — no filesystem
 * or process dependencies — so the test suite can exercise the parsing
 * edge cases (legacy meta, compiled-binary cmd, multiple `-p` markers)
 * without spinning up a real bg job.
 *
 * The stored cmd is `[interpreter, optional-cli.js, ...userFlags, '-p', directive]`;
 * we strip the leading interpreter args and the trailing `-p`/directive
 * so respawn can re-feed the same content into spawnBgJob.
 *
 * @dynamicRequire
 */
export function extractRespawnArgs(cmd: readonly string[]): {
  flags: string[]
  directive: string
} | null {
  // Drop interpreter prefix (cmd[0]) and, if it ends in 'bun', also cmd[1].
  const i = cmd[0]?.endsWith('bun') ? 2 : 1
  // Find the last '-p' marker; everything after is the directive.
  const pIdx = cmd.lastIndexOf('-p')
  if (pIdx < i || pIdx === cmd.length - 1) return null
  const flags = cmd.slice(i, pIdx)
  const directive = cmd.slice(pIdx + 1).join(' ')
  return { flags: [...flags], directive }
}
