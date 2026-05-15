/**
 * Watch for terminal background color changes via OSC 11 queries.
 *
 * When 'auto' theme is active, polls the terminal for its background color
 * every few seconds so the theme tracks live terminal profile switches
 * (e.g., iTerm2 "Switch to Light/Dark mode" or manual color changes)
 * without requiring a restart.
 *
 * Initial detection is synchronous via $COLORFGBG (systemTheme.ts);
 * this watcher corrects the guess once the OSC 11 round-trip completes
 * and continues polling for subsequent changes.
 */

import type { TerminalQuerier } from '../core/terminal-querier.js'
import { oscColor } from '../core/terminal-querier.js'
import { parseOscColor } from '../core/termio/osc.js'
import type { SystemTheme } from './systemTheme.js'
import { setCachedSystemTheme } from './systemTheme.js'

/** Poll interval in ms. Shorter than typical profile switches so it
 *  catches a manual switch promptly without spamming the pty. */
const POLL_INTERVAL = 3000

/** Compute perceived luminance from sRGB components (ITU-R BT.601). */
function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** Derive a dark/light classification from an RGB color. */
function classifyColor(r: number, g: number, b: number): SystemTheme {
  return luminance(r, g, b) > 128 ? 'light' : 'dark'
}

/**
 * Start watching the terminal background color via OSC 11.
 *
 * Sends an immediate OSC 11 query, then polls on an interval.
 * Returns a cleanup function that cancels the next scheduled poll
 * (the in-flight query will resolve harmlessly and be discarded).
 */
export function watchSystemTheme(
  querier: TerminalQuerier,
  setTheme: (theme: SystemTheme) => void,
): () => void {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined

  async function poll(): Promise<void> {
    if (cancelled) return

    try {
      const response = await querier.send(oscColor(11))
      await querier.flush()
      if (cancelled) return

      if (response) {
        const color = parseOscColor(response.data)
        if (color && color.type === 'rgb') {
          const theme = classifyColor(color.r, color.g, color.b)
          setCachedSystemTheme(theme)
          setTheme(theme)
        }
      }
    } catch {
      // OSC query failures are non-fatal — the $COLORFGBG seed
      // already provided a reasonable default.
    }

    if (!cancelled) {
      timer = setTimeout(poll, POLL_INTERVAL)
    }
  }

  // Seed poll immediately so the OSC 11 round-trip corrects the
  // COLORFGBG guess as soon as possible after switching to 'auto'.
  poll()

  return () => {
    cancelled = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
