/**
 * Detects if the current runtime is Bun.
 * Returns true when:
 * - Running a JS file via the `bun` command
 * - Running a Bun-compiled standalone executable
 */
export function isRunningWithBun(): boolean {
  // https://bun.com/guides/util/detect-bun
  return process.versions.bun !== undefined
}

/**
 * Detects if running as a Bun-compiled standalone executable.
 *
 * `Bun.embeddedFiles` is only populated when the build passes
 * `--embed-file=…` — we don't, so it stays an empty array even in a
 * `bun build --compile` binary, which made this return false on every
 * release binary. That cascaded into `getCurrentInstallationType()`
 * returning 'unknown'/'npm-global' and `AutoUpdaterWrapper` rendering
 * the legacy npm-based updater instead of `NativeAutoUpdater` —
 * auto-update never ran.
 *
 * The reliable signal: in a Bun-compiled binary, `Bun.main` (and
 * `import.meta.url`) point inside a synthetic filesystem the runtime
 * mounts to host the embedded JS bundle. When running via `bun
 * script.ts`, they're real on-disk paths instead.
 *
 * Per Bun's `StandaloneModuleGraph.zig`, the synthetic prefix differs
 * by platform:
 *   - macOS/Linux: `/$bunfs/`
 *   - Windows:     `B:\~BUN\` (canonical) — Windows file URLs require a
 *                  drive letter, so a POSIX-style `/$bunfs/` is invalid.
 *                  Path-normalization can also yield the forward-slash
 *                  form `B:/~BUN/`, so we accept both.
 *
 * The Windows variant was missing before this comment, which broke the
 * native auto-updater on every Windows release binary.
 */
const BUNFS_PREFIXES = ['/$bunfs/', 'B:\\~BUN\\', 'B:/~BUN/'] as const

/** Pure helper for testing — does this Bun.main string look like a bundled-mode entrypoint? */
export function isBundledMainPath(main: string): boolean {
  for (const prefix of BUNFS_PREFIXES) {
    if (main.startsWith(prefix)) return true
  }
  return false
}

export function isInBundledMode(): boolean {
  if (typeof Bun === 'undefined' || typeof Bun.main !== 'string') {
    return false
  }
  return isBundledMainPath(Bun.main)
}
