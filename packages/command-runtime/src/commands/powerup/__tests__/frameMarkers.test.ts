import { describe, expect, test } from 'bun:test'
import { parseFrame, parseFrameLine } from '../frameMarkers.js'

describe('parseFrameLine', () => {
  test('plain text → single segment with no color', () => {
    expect(parseFrameLine('hello world')).toEqual({
      dim: false,
      segments: [{ text: 'hello world' }],
    })
  })

  test('leading # marks the whole line dim AND is stripped from output', () => {
    expect(parseFrameLine('#dim text')).toEqual({
      dim: true,
      segments: [{ text: 'dim text' }],
    })
  })

  test('single marker in middle splits into 3 segments', () => {
    expect(parseFrameLine('hello [success:✓] world')).toEqual({
      dim: false,
      segments: [
        { text: 'hello ' },
        { text: '✓', color: 'success' },
        { text: ' world' },
      ],
    })
  })

  test('marker at start of line', () => {
    expect(parseFrameLine('[suggestion:cmd] then more')).toEqual({
      dim: false,
      segments: [
        { text: 'cmd', color: 'suggestion' },
        { text: ' then more' },
      ],
    })
  })

  test('marker at end of line', () => {
    expect(parseFrameLine('prefix [warning:◐]')).toEqual({
      dim: false,
      segments: [
        { text: 'prefix ' },
        { text: '◐', color: 'warning' },
      ],
    })
  })

  test('multiple markers same line', () => {
    expect(parseFrameLine('[success:a] mid [warning:b]')).toEqual({
      dim: false,
      segments: [
        { text: 'a', color: 'success' },
        { text: ' mid ' },
        { text: 'b', color: 'warning' },
      ],
    })
  })

  test('# combined with markers — # only affects the dim flag, markers still parsed', () => {
    expect(parseFrameLine('#$ ccb ps with [suggestion:abc123]')).toEqual({
      dim: true,
      segments: [
        { text: '$ ccb ps with ' },
        { text: 'abc123', color: 'suggestion' },
      ],
    })
  })

  test('empty line → single empty segment (so React renders an empty row)', () => {
    expect(parseFrameLine('')).toEqual({
      dim: false,
      segments: [{ text: '' }],
    })
  })

  test('# with empty body still parses to dim + empty segment', () => {
    expect(parseFrameLine('#')).toEqual({
      dim: true,
      segments: [{ text: '' }],
    })
  })
})

describe('parseFrame', () => {
  test('multi-line frame splits by newline', () => {
    const frame = 'line one\n#dim line\nline three with [success:✓]'
    expect(parseFrame(frame)).toEqual([
      { dim: false, segments: [{ text: 'line one' }] },
      { dim: true, segments: [{ text: 'dim line' }] },
      {
        dim: false,
        segments: [
          { text: 'line three with ' },
          { text: '✓', color: 'success' },
        ],
      },
    ])
  })
})
