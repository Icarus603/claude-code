/**
 * Marker regex matching ant 4303.js UK3 — `[color:text]`. Whitespace
 * inside `text` is preserved, `]` is the only forbidden character in
 * the text portion. Matches greedily on color (word chars only) and
 * everything-but-`]` for the body.
 */
const MARKER_RE = /\[(\w+):([^\]]*)\]/g

export type FrameSegment = {
  text: string
  /** Theme color name; undefined means "use default text color (or dim if line is dim)". */
  color?: string
}

export type FrameLine = {
  /** True when the line started with `#` (whole line should render dimColor). */
  dim: boolean
  segments: FrameSegment[]
}

/**
 * Mirrors ant's gK3 (4302.js:51) behaviour:
 *   1. If the line starts with `#`, set `dim: true` and strip the `#`.
 *   2. Split the remainder on `MARKER_RE`. Each `[color:text]` becomes
 *      `{ text, color }`; the surrounding text becomes `{ text }`.
 *   3. If a line ends up with zero segments (empty after the `#` strip),
 *      preserve a single empty segment so blank lines still render
 *      (otherwise React renders nothing for the row).
 */
export function parseFrameLine(line: string): FrameLine {
  const dim = line.startsWith('#')
  const body = dim ? line.slice(1) : line
  const segments: FrameSegment[] = []
  let cursor = 0

  // Reset regex state — `g` flag carries lastIndex between calls.
  const re = new RegExp(MARKER_RE.source, MARKER_RE.flags)
  for (const m of body.matchAll(re)) {
    if (m.index! > cursor) {
      segments.push({ text: body.slice(cursor, m.index!) })
    }
    segments.push({ text: m[2] ?? '', color: m[1] })
    cursor = m.index! + m[0].length
  }
  if (cursor < body.length) {
    segments.push({ text: body.slice(cursor) })
  }
  if (segments.length === 0) {
    segments.push({ text: '' })
  }
  return { dim, segments }
}

/**
 * Split a frame string into parsed lines (one entry per `\n`-separated
 * line). Used by FrameAnimation to render each frame.
 */
export function parseFrame(frame: string): FrameLine[] {
  return frame.split('\n').map(parseFrameLine)
}
