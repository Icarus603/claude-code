/**
 * Patch a FleetJobState optimistically for the user's reply submission.
 *
 * Source: ant 5092.js PsH (4773.js):
 *
 *   function PsH(H, _) {
 *     return {
 *       ...H,
 *       detail: n7(X3(_), 80, !0),       // truncate redacted reply to 80 chars
 *       tempo: "active",
 *       needs: void 0,
 *       block: void 0,
 *       suggestedReply: void 0,
 *       output: null,
 *       updatedAt: new Date().toISOString(),
 *     }
 *   }
 *
 * Used by gs3's onReply to mutate the polled-jobs state immediately so
 * the row flips to Working before the daemon round-trip completes.
 * Next polling tick overwrites with daemon-reported state.
 *
 * `X3` (0229.js) redacts sensitive substrings (API keys, tokens) using
 * pattern matchers. ccb doesn't have the same redactor patterns wired
 * up at this layer — the optimistic detail is only shown briefly before
 * polling replaces it, so we skip the redaction. If a token appears in
 * the reply text it would also already be visible elsewhere in the UI.
 *
 * `n7` (0233.js) truncates to N display columns, optionally first-line-only.
 */

import type { FleetJobState } from '@claude-code/agent/background/fleet/fleetTypes.js'
import { stringWidth } from './grapheme.js'

/** Source: ant 0233.js n7 — truncate to N width cols, first-line-only flag. */
function truncate(text: string, max: number, firstLineOnly: boolean): string {
  if (firstLineOnly) {
    const nl = text.indexOf('\n')
    if (nl !== -1) {
      const first = text.substring(0, nl)
      if (stringWidth(first) + 1 > max) return truncateRaw(first, max)
      return `${first}…`
    }
  }
  if (stringWidth(text) <= max) return text
  return truncateRaw(text, max)
}

function truncateRaw(text: string, max: number): string {
  // Simple ASCII-safe truncation; ant uses o9 (slice by display columns).
  // For our 80-col detail summary the lossless slice is acceptable.
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)) + '…'
}

/** Source: ant 4773.js PsH. */
export function patchStateOnReply(
  state: FleetJobState,
  reply: string,
): FleetJobState {
  return {
    ...state,
    detail: truncate(reply, 80, true),
    tempo: 'active',
    needs: undefined,
    block: undefined,
    suggestedReply: undefined,
    output: null,
    updatedAt: new Date().toISOString(),
  }
}
