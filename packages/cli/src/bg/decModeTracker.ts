/**
 * DEC private mode tracker — port of ant 4766.js `RZ_()` factory +
 * 4767.js `sNK` tracked-mode allowlist.
 *
 * Watches the PTY stream for `CSI ? <num>(;<num>)* (h|l)` sequences
 * (DEC private mode set/reset) and records the current state so that
 * on attach detach we can emit the inverse to restore the local
 * terminal's mouse-mode / bracketed-paste state — without this,
 * detaching from a session that enabled mouse leaves the local terminal
 * stuck in mouse-mode (clicks send escape codes instead of moving the
 * cursor).
 *
 * **Critical: allowlist gate** (ant 4767.js):
 *   sNK = new Set([1000, 1002, 1003, 1004, 1006, 2004, 2031])
 *   if (sNK.has(J) && H.has(J) !== w) {        // only track if in allowlist
 *     if (w) H.add(J), K?.(J)
 *     else H.delete(J)
 *   }
 *
 * Only "soft" terminal modes that the OUTER caller doesn't manage are
 * tracked + restored. Notably ABSENT from the allowlist:
 *   - 1049 (alt-screen) — owned by the outer FleetView via handoffAltScreen.
 *     If ccb tracks + restores 1049, detach emits `?1049l` → terminal
 *     exits alt-screen → "exit ccb" shell prompt flashes briefly →
 *     FleetView remounts and re-enters alt-screen. Visible flicker.
 *   - 1 (DECCKM cursor keys), 25 (cursor visibility) — caller owns these.
 *
 * Tracked modes (allowlist):
 *   1000/1002/1003 — mouse tracking (X10/cell/all-event)
 *   1004 — focus reporting
 *   1006 — SGR mouse extension
 *   2004 — bracketed paste
 *   2031 — DECRPM (terminal text style notification — ghostty/iTerm2)
 *
 * @dynamicRequire
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the literal char we're matching
const DEC_MODE_RE = /\x1b\[\?([\d;]+)([hl])/g

/**
 * Modes that are safe to restore on detach. Source: ant 4767.js `sNK`.
 * Anything outside this set is the OUTER caller's responsibility — most
 * importantly 1049 (alt-screen) which would flash to main screen if
 * we toggled it during detach.
 */
const TRACKED_MODES: ReadonlySet<number> = new Set([
  1000, 1002, 1003, 1004, 1006, 2004, 2031,
])

export interface DecModeTracker {
  /** Feed a chunk of raw PTY output; updates internal state. */
  feed(chunk: Buffer | string): void
  /** Snapshot of currently-enabled DEC modes. */
  snapshot(): number[]
  /** ANSI to emit on detach to restore local terminal to default state. */
  restoreSequence(): string
}

export function createDecModeTracker(): DecModeTracker {
  const enabled = new Set<number>()
  const text = (chunk: Buffer | string): string =>
    typeof chunk === 'string' ? chunk : chunk.toString('latin1')
  return {
    feed(chunk) {
      const s = text(chunk)
      DEC_MODE_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = DEC_MODE_RE.exec(s)) !== null) {
        const action = m[2]
        const ids = m[1]!.split(';').map(n => Number.parseInt(n, 10)).filter(Number.isFinite)
        for (const id of ids) {
          if (!TRACKED_MODES.has(id)) continue
          if (action === 'h') enabled.add(id)
          else enabled.delete(id)
        }
      }
    },
    snapshot() {
      return [...enabled].sort((a, b) => a - b)
    },
    restoreSequence() {
      // Emit `\x1b[?<id>l` for every still-enabled mode → resets each
      // back to its default. Reverse order to match ant 4767.js
      // `E.snapshot().map(bF).reverse().join("")`.
      const ids = [...enabled].sort((a, b) => b - a)
      return ids.map(id => `\x1b[?${id}l`).join('')
    },
  }
}
