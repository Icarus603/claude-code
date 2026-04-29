import { describe, expect, test } from 'bun:test'
import {
  extractDiscoveredToolNames,
  isToolReferenceBlock,
} from '../toolSearch.js'

type Msg = Parameters<typeof extractDiscoveredToolNames>[0][number]

describe('isToolReferenceBlock — runtime type guard', () => {
  test('valid tool_reference block → true', () => {
    expect(isToolReferenceBlock({ type: 'tool_reference' })).toBe(true)
  })

  test('tool_reference with extra fields still matches', () => {
    expect(
      isToolReferenceBlock({ type: 'tool_reference', tool_name: 'X' }),
    ).toBe(true)
  })

  test('different type → false', () => {
    expect(isToolReferenceBlock({ type: 'tool_use' })).toBe(false)
    expect(isToolReferenceBlock({ type: 'text' })).toBe(false)
    expect(isToolReferenceBlock({ type: 'tool_result' })).toBe(false)
  })

  test('null → false', () => {
    expect(isToolReferenceBlock(null)).toBe(false)
  })

  test('undefined → false', () => {
    expect(isToolReferenceBlock(undefined)).toBe(false)
  })

  test('primitives → false', () => {
    expect(isToolReferenceBlock('tool_reference')).toBe(false)
    expect(isToolReferenceBlock(42)).toBe(false)
    expect(isToolReferenceBlock(true)).toBe(false)
  })

  test('object without type field → false', () => {
    expect(isToolReferenceBlock({ tool_name: 'X' })).toBe(false)
  })

  test('object with type but wrong value → false', () => {
    expect(isToolReferenceBlock({ type: 'TOOL_REFERENCE' })).toBe(false) // case-sensitive
    expect(isToolReferenceBlock({ type: '' })).toBe(false)
  })

  test('array → false (typeof [] === "object" but no type field)', () => {
    expect(isToolReferenceBlock([])).toBe(false)
    expect(isToolReferenceBlock([{ type: 'tool_reference' }])).toBe(false)
  })
})

describe('extractDiscoveredToolNames — empty input', () => {
  test('empty array → empty set', () => {
    expect(extractDiscoveredToolNames([])).toEqual(new Set())
  })
})

describe('extractDiscoveredToolNames — message-type filtering', () => {
  test('assistant messages skipped (only user has tool_result)', () => {
    // Even if we shoved tool_result into an assistant message (impossible
    // in practice), the function should not scan it.
    const msgs: Msg[] = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_result',
              content: [{ type: 'tool_reference', tool_name: 'foo' }],
            },
          ],
        },
      } as Msg,
    ]
    expect(extractDiscoveredToolNames(msgs)).toEqual(new Set())
  })

  test('progress messages skipped', () => {
    const msgs: Msg[] = [
      {
        type: 'progress',
        message: {
          content: [
            {
              type: 'tool_result',
              content: [{ type: 'tool_reference', tool_name: 'foo' }],
            },
          ],
        },
      } as Msg,
    ]
    expect(extractDiscoveredToolNames(msgs)).toEqual(new Set())
  })

  test('non-array content skipped silently', () => {
    const msgs: Msg[] = [
      { type: 'user', message: { content: 'plain text' } } as Msg,
    ]
    expect(extractDiscoveredToolNames(msgs)).toEqual(new Set())
  })

  test('missing message field skipped', () => {
    const msgs: Msg[] = [{ type: 'user' } as Msg]
    expect(extractDiscoveredToolNames(msgs)).toEqual(new Set())
  })
})

describe('extractDiscoveredToolNames — tool_reference extraction', () => {
  test('single tool_reference inside tool_result', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              content: [{ type: 'tool_reference', tool_name: 'mcp__foo' }],
            },
          ],
        },
      } as Msg,
    ]
    expect(extractDiscoveredToolNames(msgs)).toEqual(new Set(['mcp__foo']))
  })

  test('multiple tool_references in same tool_result', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              content: [
                { type: 'tool_reference', tool_name: 'a' },
                { type: 'tool_reference', tool_name: 'b' },
                { type: 'tool_reference', tool_name: 'c' },
              ],
            },
          ],
        },
      } as Msg,
    ]
    expect(extractDiscoveredToolNames(msgs)).toEqual(
      new Set(['a', 'b', 'c']),
    )
  })

  test('multiple tool_results across messages — accumulated', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              content: [{ type: 'tool_reference', tool_name: 'a' }],
            },
          ],
        },
      } as Msg,
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              content: [{ type: 'tool_reference', tool_name: 'b' }],
            },
          ],
        },
      } as Msg,
    ]
    expect(extractDiscoveredToolNames(msgs)).toEqual(new Set(['a', 'b']))
  })

  test('duplicates de-duplicated by Set', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              content: [
                { type: 'tool_reference', tool_name: 'foo' },
                { type: 'tool_reference', tool_name: 'foo' },
              ],
            },
          ],
        },
      } as Msg,
    ]
    expect(extractDiscoveredToolNames(msgs)).toEqual(new Set(['foo']))
  })

  test('tool_reference mixed with non-references — only references extracted', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              content: [
                { type: 'text', text: 'some output' },
                { type: 'tool_reference', tool_name: 'mcp__foo' },
                { type: 'image', source: { type: 'base64' } },
              ],
            },
          ],
        },
      } as Msg,
    ]
    expect(extractDiscoveredToolNames(msgs)).toEqual(new Set(['mcp__foo']))
  })

  test('tool_reference WITHOUT tool_name field is skipped', () => {
    // The runtime check requires both 'type' === 'tool_reference' AND
    // 'tool_name' to be a string. A malformed entry without tool_name
    // is silently skipped (defensive).
    const msgs: Msg[] = [
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              content: [{ type: 'tool_reference' }], // no tool_name
            },
          ],
        },
      } as Msg,
    ]
    expect(extractDiscoveredToolNames(msgs)).toEqual(new Set())
  })

  test('tool_reference with non-string tool_name is skipped', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              content: [{ type: 'tool_reference', tool_name: 42 }],
            },
          ],
        },
      } as Msg,
    ]
    expect(extractDiscoveredToolNames(msgs)).toEqual(new Set())
  })

  test('tool_result with non-array content silently skipped', () => {
    // The isToolResultBlockWithContent guard requires Array.isArray(content).
    const msgs: Msg[] = [
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', content: 'not an array' }],
        },
      } as Msg,
    ]
    expect(extractDiscoveredToolNames(msgs)).toEqual(new Set())
  })
})

describe('extractDiscoveredToolNames — compact_boundary carry', () => {
  // CRITICAL: when compaction summarizes tool_reference-bearing messages,
  // the discovered set is snapshotted on the boundary marker. The scan
  // reads it back. Without this, post-compaction the model would lose
  // visibility into the tools it had previously discovered.

  test('compact_boundary with preCompactDiscoveredTools carries names', () => {
    const msgs: Msg[] = [
      {
        type: 'system',
        subtype: 'compact_boundary',
        compactMetadata: {
          preCompactDiscoveredTools: ['mcp__a', 'mcp__b'],
        },
      } as unknown as Msg,
    ]
    expect(extractDiscoveredToolNames(msgs)).toEqual(
      new Set(['mcp__a', 'mcp__b']),
    )
  })

  test('compact_boundary WITHOUT preCompactDiscoveredTools is no-op', () => {
    const msgs: Msg[] = [
      {
        type: 'system',
        subtype: 'compact_boundary',
      } as unknown as Msg,
    ]
    expect(extractDiscoveredToolNames(msgs)).toEqual(new Set())
  })

  test('non-compact system message (different subtype) is no-op', () => {
    const msgs: Msg[] = [
      {
        type: 'system',
        subtype: 'init',
        compactMetadata: { preCompactDiscoveredTools: ['x'] },
      } as unknown as Msg,
    ]
    // Not a compact_boundary → not a carry candidate. Discovery only fires
    // for compact_boundary specifically.
    expect(extractDiscoveredToolNames(msgs)).toEqual(new Set())
  })

  test('carried tools accumulate with post-compact discoveries', () => {
    const msgs: Msg[] = [
      {
        type: 'system',
        subtype: 'compact_boundary',
        compactMetadata: { preCompactDiscoveredTools: ['mcp__pre'] },
      } as unknown as Msg,
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              content: [{ type: 'tool_reference', tool_name: 'mcp__post' }],
            },
          ],
        },
      } as Msg,
    ]
    expect(extractDiscoveredToolNames(msgs)).toEqual(
      new Set(['mcp__pre', 'mcp__post']),
    )
  })
})

describe('extractDiscoveredToolNames — return value contract', () => {
  test('returns a Set instance', () => {
    expect(extractDiscoveredToolNames([])).toBeInstanceOf(Set)
  })

  test('returns a fresh Set per call (no shared mutation)', () => {
    const r1 = extractDiscoveredToolNames([])
    const r2 = extractDiscoveredToolNames([])
    expect(r1).not.toBe(r2)
  })
})
