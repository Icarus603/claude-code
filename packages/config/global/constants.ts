// These constants are in a separate file to avoid circular dependency issues.
// Do NOT add imports to this file - it must remain dependency-free.

export const NOTIFICATION_CHANNELS = [
  'auto',
  'iterm2',
  'iterm2_with_bell',
  'terminal_bell',
  'kitty',
  'ghostty',
  'notifications_disabled',
] as const

// Valid editor modes (excludes deprecated 'emacs' which is auto-migrated to 'normal')
export const EDITOR_MODES = ['normal', 'vim'] as const

// Valid teammate modes for spawning
// 'tmux' = traditional tmux-based teammates
// 'in-process' = in-process teammates running in same process
// 'auto' = automatically choose based on context (default)
export const TEAMMATE_MODES = ['auto', 'tmux', 'in-process'] as const

/**
 * Returns the name the user invoked the CLI with (e.g. "ccb", "claude").
 *
 * Used for user-facing strings like "Resume this session with: <name> --resume".
 * Decompiled-from-ant strings hardcoded "claude"; ccb is distributed as `ccb`.
 *
 * Preference order:
 *  1. `process.argv0` — what shell saw (matches the symlink the user typed).
 *     For `bun build --compile` standalone binaries this is "ccb".
 *  2. basename of `process.argv[1]` — Bun-script and dev-mode fallback.
 *  3. Hard fallback "ccb" — this is a ccb fork; cosmetic, not load-bearing.
 *
 * Stripped: bun runner names ("bun", "node"), TypeScript entry filenames
 * ("cli.tsx") — these aren't user-facing invocation names.
 */
export function getInvokedBinaryName(): string {
  const candidates = [process.argv0, process.argv[1]]
  for (const raw of candidates) {
    if (!raw) continue
    const base = raw.split('/').pop()?.replace(/\.(tsx?|jsx?|exe)$/, '') ?? ''
    if (!base) continue
    if (base === 'bun' || base === 'node' || base === 'cli') continue
    return base
  }
  return 'ccb'
}
