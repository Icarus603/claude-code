/**
 * Filter-bar query parser.
 *
 * Source: ant VdK (5092.js:204-221) + RZ6 (5092.js:222-226) +
 * LZ6 (5092.js:227-229) + xyH (frame ref parser, external module).
 *
 * Query language (case-insensitive, whitespace-split):
 *   a:foo   → filter by agent template name
 *   s:bar   → filter by section bucket (working/blocked/done/review)
 *   o:abc   → filter by origin token (output match)
 *   #123    → filter by PR ref (also matches `/pull/123` URLs)
 *   bare token → free-text label match
 *
 * Unrecognised "frame-XYZ" tokens are caught via the frame-ref parser.
 */

/** Source: ant VdK return shape. */
export interface ParsedQuery {
  /** `a:foo` — undefined if not present. */
  template?: string
  /** `s:bar`. */
  state?: string
  /** `o:abc`. */
  output?: string
  /** `#123` → "123". */
  pr?: string
  /** Frame ref id (without "frame-" prefix), or undefined. */
  frame?: string
  /** Free-text remaining tokens, joined by spaces. */
  text: string
}

const PR_NUMBER_RE = /^#(\d+)$/
const PR_URL_RE = /\/pull\/(\d+)(?!\d)/
const FRAME_REF_RE = /^frame-([A-Za-z0-9_-]+)$/

/** Source: ant RZ6. */
export function parsePrRef(token: string): string | null {
  const t = token.trim()
  if (/\s/.test(t)) return null
  return (PR_NUMBER_RE.exec(t) ?? PR_URL_RE.exec(t))?.[1] ?? null
}

/** Source: ant LZ6. */
export function buildPrRefRegex(prNumber: string): RegExp {
  return new RegExp(`/pull/${prNumber}(?!\\d)`)
}

/**
 * Frame ref parser. Source: ant xyH.
 *
 * ant matches both antspace URLs (https://*.frame.antspace.dev/...) AND
 * bare `frame-<id>` tokens. ccb collapses to the bare token form — frame
 * URLs are routed via the input handler's separate URL detector.
 */
export function parseFrameRef(token: string): string | null {
  return FRAME_REF_RE.exec(token.trim())?.[1] ?? null
}

/** Source: ant VdK. */
export function parseQuery(input: string): ParsedQuery {
  const remaining: string[] = []
  let template: string | undefined
  let state: string | undefined
  let output: string | undefined
  let pr: string | undefined
  let frame: string | undefined

  for (const raw of input.trim().split(/\s+/).filter(Boolean)) {
    const lower = raw.toLowerCase()
    if (lower.startsWith('a:')) {
      template = lower.slice(2) || undefined
    } else if (lower.startsWith('s:')) {
      state = lower.slice(2) || undefined
    } else if (lower.startsWith('o:')) {
      output = lower.slice(2)
    } else {
      const prMatch = parsePrRef(raw)
      if (prMatch !== null) {
        pr = prMatch
        continue
      }
      const frameMatch = parseFrameRef(raw)
      if (frameMatch !== null) {
        frame = frameMatch
        continue
      }
      remaining.push(raw)
    }
  }

  return {
    template,
    state,
    output,
    pr,
    frame,
    text: remaining.join(' ').toLowerCase(),
  }
}
