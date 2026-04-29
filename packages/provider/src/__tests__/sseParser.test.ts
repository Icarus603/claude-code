import { describe, expect, test } from 'bun:test'
import { parseSSEFrames } from '../gemini/sseParser.js'

describe('parseSSEFrames — basic frames', () => {
  test('single complete frame extracted', () => {
    const { frames, remaining } = parseSSEFrames('data: hello\n\n')
    expect(frames).toEqual([{ data: 'hello' }])
    expect(remaining).toBe('')
  })

  test('multiple frames split on double-newline', () => {
    const { frames, remaining } = parseSSEFrames(
      'data: a\n\ndata: b\n\ndata: c\n\n',
    )
    expect(frames).toEqual([{ data: 'a' }, { data: 'b' }, { data: 'c' }])
    expect(remaining).toBe('')
  })

  test('incomplete trailing frame returned in remaining', () => {
    const { frames, remaining } = parseSSEFrames(
      'data: complete\n\ndata: incomplete',
    )
    expect(frames).toEqual([{ data: 'complete' }])
    expect(remaining).toBe('data: incomplete')
  })

  test('all-incomplete buffer → no frames, full remaining', () => {
    const { frames, remaining } = parseSSEFrames('data: partial')
    expect(frames).toEqual([])
    expect(remaining).toBe('data: partial')
  })

  test('empty buffer → no frames', () => {
    const { frames, remaining } = parseSSEFrames('')
    expect(frames).toEqual([])
    expect(remaining).toBe('')
  })
})

describe('parseSSEFrames — field parsing', () => {
  test('event field extracted', () => {
    expect(
      parseSSEFrames('event: message\ndata: hi\n\n').frames,
    ).toEqual([{ event: 'message', data: 'hi' }])
  })

  test('id field extracted', () => {
    expect(parseSSEFrames('id: 42\ndata: hi\n\n').frames).toEqual([
      { id: '42', data: 'hi' },
    ])
  })

  test('all 3 fields together', () => {
    expect(
      parseSSEFrames('event: chunk\nid: 1\ndata: payload\n\n').frames,
    ).toEqual([{ event: 'chunk', id: '1', data: 'payload' }])
  })

  test('unknown fields silently dropped (retry: ignored)', () => {
    expect(
      parseSSEFrames('retry: 5000\ndata: hi\n\n').frames,
    ).toEqual([{ data: 'hi' }])
  })

  test('multiple data: lines concatenated with \\n (per spec)', () => {
    // Per SSE spec, multi-line data is joined with \n. Critical for
    // streaming JSON payloads that span lines.
    expect(
      parseSSEFrames('data: line1\ndata: line2\ndata: line3\n\n').frames,
    ).toEqual([{ data: 'line1\nline2\nline3' }])
  })

  test('multiple event: lines — last wins', () => {
    // SSE spec is silent on duplicate non-data fields. The implementation
    // overwrites — last value wins. Document this.
    expect(
      parseSSEFrames('event: first\nevent: last\ndata: x\n\n').frames,
    ).toEqual([{ event: 'last', data: 'x' }])
  })
})

describe('parseSSEFrames — colon and value handling', () => {
  test('one leading space after colon stripped', () => {
    expect(parseSSEFrames('data: hi\n\n').frames).toEqual([{ data: 'hi' }])
  })

  test('NO leading space → value has no offset removed', () => {
    expect(parseSSEFrames('data:hi\n\n').frames).toEqual([{ data: 'hi' }])
  })

  test('TWO leading spaces — only ONE stripped', () => {
    // The spec says strip ONE leading space. Two spaces means one survives.
    expect(parseSSEFrames('data:  hi\n\n').frames).toEqual([
      { data: ' hi' },
    ])
  })

  test('value containing colons preserved', () => {
    // The split is on FIRST colon only.
    expect(parseSSEFrames('data: http://example.com\n\n').frames).toEqual([
      { data: 'http://example.com' },
    ])
  })

  test('line without colon → silently skipped', () => {
    // Documents that lines with no `:` (and not starting with `:`) are
    // ignored. SSE spec says treat as field name with empty value, but
    // our implementation drops them.
    expect(
      parseSSEFrames('garbage\ndata: hi\n\n').frames,
    ).toEqual([{ data: 'hi' }])
  })

  test('empty value — frame DROPPED (data="" is falsy in emit guard)', () => {
    // The final guard is `if (frame.data || isComment)`. Empty-string
    // data is falsy, so the frame is silently dropped. Documents this
    // for the same reason as the explicit "empty data" test below.
    expect(parseSSEFrames('data:\n\n').frames).toEqual([])
  })
})

describe('parseSSEFrames — comments + keepalives', () => {
  test('comment-only frame (`:keepalive`) emits empty frame', () => {
    // The implementation does emit comment-only frames (with no data) so
    // callers can refresh liveness timers. Documents this design choice.
    expect(parseSSEFrames(':keepalive\n\n').frames).toEqual([{}])
  })

  test('comment + data frame — data preserved', () => {
    expect(
      parseSSEFrames(':comment line\ndata: real\n\n').frames,
    ).toEqual([{ data: 'real' }])
  })

  test('multi-line comment-only frame', () => {
    expect(
      parseSSEFrames(':line1\n:line2\n\n').frames,
    ).toEqual([{}])
  })
})

describe('parseSSEFrames — edge cases', () => {
  test('whitespace-only frame skipped', () => {
    expect(parseSSEFrames('   \n\ndata: real\n\n').frames).toEqual([
      { data: 'real' },
    ])
  })

  test('frame with NO data and NO comment NOT emitted', () => {
    // The final guard: `if (frame.data || isComment)`. event-only or
    // id-only frames with no data and no comment are dropped.
    // This is a contract — SSE clients only act on data-bearing frames.
    expect(parseSSEFrames('event: hi\n\n').frames).toEqual([])
    expect(parseSSEFrames('id: 42\n\n').frames).toEqual([])
  })

  test('empty data field IS emitted (truthy because present)', () => {
    // CRITICAL probe: `data: \n\n` parses frame.data='' which is FALSY.
    // The guard `if (frame.data || isComment)` would EXCLUDE this empty
    // data. Document this — empty data SSE events are silently dropped.
    expect(parseSSEFrames('data: \n\n').frames).toEqual([])
    expect(parseSSEFrames('data:\n\n').frames).toEqual([])
  })

  test('multiple consecutive double-newlines → empty frames skipped', () => {
    expect(
      parseSSEFrames('data: a\n\n\n\ndata: b\n\n').frames,
    ).toEqual([{ data: 'a' }, { data: 'b' }])
  })

  test('leading double-newline produces no frame', () => {
    expect(parseSSEFrames('\n\ndata: x\n\n').frames).toEqual([
      { data: 'x' },
    ])
  })

  test('CRLF line endings (\\r\\n\\r\\n) — normalized to LF, frames parsed', () => {
    // WHATWG SSE spec requires CRLF, LF, and CR-only line endings ALL
    // be valid frame separators. Without normalization, a CRLF-emitting
    // server (Gemini observed in some proxy configurations) would
    // produce 0 frames and the stream would hang.
    expect(parseSSEFrames('data: hi\r\n\r\n').frames).toEqual([{ data: 'hi' }])
  })

  test('CR-only line endings (\\r\\r) — also normalized', () => {
    // Classic Mac line endings. Spec requires support.
    expect(parseSSEFrames('data: hi\r\r').frames).toEqual([{ data: 'hi' }])
  })

  test('mixed CRLF + LF in same buffer normalized correctly', () => {
    // A frame with CRLF separator inside (data spans lines via CRLF) and
    // LF terminator both work. After normalization the buffer becomes
    // LF-only.
    expect(
      parseSSEFrames('event: e\r\ndata: x\n\n').frames,
    ).toEqual([{ event: 'e', data: 'x' }])
  })

  test('partial frame in middle followed by complete', () => {
    const { frames, remaining } = parseSSEFrames(
      'data: complete\n\ndata: incomplete\nevent:',
    )
    expect(frames).toEqual([{ data: 'complete' }])
    expect(remaining).toBe('data: incomplete\nevent:')
  })

  test('streaming-recompose: partial+complete → full frame after second call', () => {
    // Common usage: feed buffer chunks. First call gets partial, second
    // call (with remaining + new data) completes the frame.
    const r1 = parseSSEFrames('data: part1')
    expect(r1.frames).toEqual([])

    const r2 = parseSSEFrames(r1.remaining + ' part2\n\n')
    expect(r2.frames).toEqual([{ data: 'part1 part2' }])
  })

  test('non-string fields in mixed payload', () => {
    // event then 2 data lines then unrelated line.
    expect(
      parseSSEFrames('event: chunk\ndata: a\ndata: b\nignored: junk\n\n').frames,
    ).toEqual([{ event: 'chunk', data: 'a\nb' }])
  })

  test('frames separated by trailing data after final \\n\\n in remaining', () => {
    const { frames, remaining } = parseSSEFrames(
      'data: a\n\ndata: ',
    )
    expect(frames).toEqual([{ data: 'a' }])
    expect(remaining).toBe('data: ')
  })
})

describe('parseSSEFrames — Anthropic-style streaming probe', () => {
  // Real-world wire format Anthropic uses for streaming.
  test('event + JSON data frame', () => {
    const wire =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0}\n\n'
    expect(parseSSEFrames(wire).frames).toEqual([
      {
        event: 'content_block_delta',
        data: '{"type":"content_block_delta","index":0}',
      },
    ])
  })

  test('multiple JSON data lines (multi-line JSON via spec)', () => {
    // Real servers don't usually do this but the spec allows it.
    const wire = 'event: e\ndata: {\ndata:   "x": 1\ndata: }\n\n'
    expect(parseSSEFrames(wire).frames).toEqual([
      { event: 'e', data: '{\n  "x": 1\n}' },
    ])
  })

  test('mixed comment-keepalive between data frames', () => {
    const wire =
      'data: first\n\n:keep-alive\n\ndata: second\n\n'
    expect(parseSSEFrames(wire).frames).toEqual([
      { data: 'first' },
      {}, // keep-alive frame
      { data: 'second' },
    ])
  })
})
