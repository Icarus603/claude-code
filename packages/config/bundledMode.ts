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
 * `import.meta.url`) point inside the synthetic `/$bunfs/` filesystem
 * the runtime mounts to host the embedded JS bundle. When running via
 * `bun script.ts`, they're real on-disk paths instead.
 */
export function isInBundledMode(): boolean {
  return (
    typeof Bun !== 'undefined' &&
    typeof Bun.main === 'string' &&
    Bun.main.startsWith('/$bunfs/')
  )
}
