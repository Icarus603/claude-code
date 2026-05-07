/**
 * DEC private mode tracker — port of ant 4638.js FjK / VX_ pair.
 *
 * Watches the PTY stream for `CSI ? <num>(;<num>)* (h|l)` sequences
 * (DEC private mode set/reset) and records the current state so that
 * on attach detach we can emit the inverse to restore the local
 * terminal's mouse-mode / alt-screen / bracketed-paste / cursor state
 * — without this, detaching from a session that enabled mouse leaves
 * the local terminal stuck in mouse-mode (clicks send escape codes
 * instead of moving the cursor).
 *
 * Common DEC modes seen in claude:
 *   1   — DECCKM (cursor keys application mode)
 *   25  — DECTCEM (cursor visibility)
 *   1000/1002/1003/1006 — mouse tracking
 *   1004 — focus reporting
 *   1049 — alt screen + save cursor
 *   2004 — bracketed paste
 *
 * @dynamicRequire
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the literal char we're matching
const DEC_MODE_RE = /\x1b\[\?([\d;]+)([hl])/g

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
      // back to its default. Order matters slightly: alt-screen exit
      // (1049) goes last so prior writes still target alt-screen if
      // the user was reading from it.
      const ids = [...enabled].sort((a, b) => {
        if (a === 1049) return 1
        if (b === 1049) return -1
        return a - b
      })
      return ids.map(id => `\x1b[?${id}l`).join('')
    },
  }
}
