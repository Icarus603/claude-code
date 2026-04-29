/**
 * SSE frame parser inlined from @claude-code/cli SSETransport.
 * Avoids a cross-package dependency on the CLI package.
 */

type SSEFrame = {
  event?: string
  id?: string
  data?: string
}

/**
 * Incrementally parse SSE frames from a text buffer.
 * Returns parsed frames and the remaining (incomplete) buffer.
 *
 * Per WHATWG SSE spec, lines may end with CRLF, LF, or CR. We normalize
 * any CR or CRLF to LF before scanning so all three line endings produce
 * the same `\n\n` frame boundary. Without this, a server emitting CRLF
 * (Gemini observed in some proxy configurations) would never produce a
 * parsed frame and the stream would hang.
 */
export function parseSSEFrames(buffer: string): {
  frames: SSEFrame[]
  remaining: string
} {
  // Normalize line endings: CRLF → LF, then standalone CR → LF.
  // Order matters — CRLF must be replaced first so each pair becomes one LF.
  if (buffer.includes('\r')) {
    buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  }

  const frames: SSEFrame[] = []
  let pos = 0

  // SSE frames are delimited by double newlines
  let idx: number
  while ((idx = buffer.indexOf('\n\n', pos)) !== -1) {
    const rawFrame = buffer.slice(pos, idx)
    pos = idx + 2

    // Skip empty frames
    if (!rawFrame.trim()) continue

    const frame: SSEFrame = {}
    let isComment = false

    for (const line of rawFrame.split('\n')) {
      if (line.startsWith(':')) {
        // SSE comment (e.g., `:keepalive`)
        isComment = true
        continue
      }

      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue

      const field = line.slice(0, colonIdx)
      // Per SSE spec, strip one leading space after colon if present
      const value =
        line[colonIdx + 1] === ' '
          ? line.slice(colonIdx + 2)
          : line.slice(colonIdx + 1)

      switch (field) {
        case 'event':
          frame.event = value
          break
        case 'id':
          frame.id = value
          break
        case 'data':
          // Per SSE spec, multiple data: lines are concatenated with \n
          frame.data = frame.data ? frame.data + '\n' + value : value
          break
        // Ignore other fields (retry:, etc.)
      }
    }

    // Only emit frames that have data (or are pure comments which reset liveness)
    if (frame.data || isComment) {
      frames.push(frame)
    }
  }

  return { frames, remaining: buffer.slice(pos) }
}
