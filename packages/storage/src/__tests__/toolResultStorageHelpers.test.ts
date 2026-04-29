/**
 * Tests for toolResultStorage.ts pure helpers.
 *
 * generatePreview decides what the model sees when a tool result is too
 * large to inline — wrong newline-boundary logic produces mid-line cuts
 * that confuse the model.
 *
 * isToolResultContentEmpty triggers the inc-4586 mitigation (empty
 * tool_result poisons capybara turn boundaries). Wrong "empty" detection
 * either spams the marker on real outputs or misses the silent-success
 * case.
 *
 * isPersistError is a discriminated-union type guard — wrong narrowing
 * silently treats persistence failures as success.
 *
 * getPersistenceThreshold is THE knob that decides which tools opt out
 * (Infinity), which use overrides (GrowthBook), and which clamp to the
 * default. A flag served as `null` would crash without the typeof guard.
 */
import { describe, expect, mock, test } from 'bun:test'

// getFeatureValue_CACHED_MAY_BE_STALE returns the GrowthBook flag value.
// Mock it with a controllable value per test. The threshold check reads
// `tengu_satin_quoll` (PERSIST_THRESHOLD_OVERRIDE_FLAG).
let nextFlagValue: unknown = {}
const realGB = await import('@claude-code/config/feature-flags')
mock.module('@claude-code/config/feature-flags', () => ({
  ...realGB,
  getFeatureValue_CACHED_MAY_BE_STALE: () => nextFlagValue,
}))

const {
  generatePreview,
  isToolResultContentEmpty,
  isPersistError,
  getPersistenceThreshold,
  buildLargeToolResultMessage,
} = await import('../toolResultStorage.js')

describe('generatePreview — content fits within limit', () => {
  test('content shorter than maxBytes returns full content, hasMore=false', () => {
    expect(generatePreview('hello', 100)).toEqual({
      preview: 'hello',
      hasMore: false,
    })
  })

  test('content exactly at maxBytes returns full content, hasMore=false', () => {
    const s = 'a'.repeat(100)
    expect(generatePreview(s, 100)).toEqual({ preview: s, hasMore: false })
  })

  test('empty content returns empty preview, hasMore=false', () => {
    expect(generatePreview('', 100)).toEqual({ preview: '', hasMore: false })
  })
})

describe('generatePreview — content exceeds limit, newline-boundary cut', () => {
  test('newline past 50% threshold: cut at newline', () => {
    // maxBytes=100, content has \n at position 60 (>50%)
    const content = 'a'.repeat(60) + '\n' + 'b'.repeat(100)
    const r = generatePreview(content, 100)
    expect(r.hasMore).toBe(true)
    expect(r.preview).toBe('a'.repeat(60))
    expect(r.preview).not.toContain('\n')
  })

  test('newline before 50% threshold: cut at exact maxBytes', () => {
    // maxBytes=100, only newline is at position 30 (<50%)
    const content = 'a'.repeat(30) + '\n' + 'b'.repeat(200)
    const r = generatePreview(content, 100)
    expect(r.hasMore).toBe(true)
    expect(r.preview.length).toBe(100)
    // Cut mid-line — preview INCLUDES the newline at pos 30 + 70 'b's.
    expect(r.preview).toContain('\n')
  })

  test('no newline at all: cut at exact maxBytes', () => {
    const content = 'a'.repeat(500)
    const r = generatePreview(content, 100)
    expect(r.hasMore).toBe(true)
    expect(r.preview).toBe('a'.repeat(100))
  })

  test('newline at exactly 50% threshold: NOT used (strict >, not >=)', () => {
    // The check is `lastNewline > maxBytes * 0.5`. Newline at position
    // 50 with maxBytes=100 → 50 > 50 is false → fall to maxBytes cut.
    const content = 'a'.repeat(50) + '\n' + 'b'.repeat(200)
    const r = generatePreview(content, 100)
    expect(r.hasMore).toBe(true)
    expect(r.preview.length).toBe(100)
  })

  test('multi-newline content: uses LAST newline within window (cut excludes newline)', () => {
    // a*20 \n b*39 \n c*29 \n d*120 — newlines at positions 20, 60, 90.
    // Total length 211, window 100. lastIndexOf('\n') in truncated = 90.
    // 90 > 50 → cutPoint = 90 → preview = content.slice(0, 90).
    // slice() is exclusive of end → preview length = 90, ends in last 'c'
    // (the newline at index 90 is NOT included). This is documented
    // behavior: the cut runs UP TO but not THROUGH the newline.
    const content =
      'a'.repeat(20) +
      '\n' +
      'b'.repeat(39) +
      '\n' +
      'c'.repeat(29) +
      '\n' +
      'd'.repeat(120)
    const r = generatePreview(content, 100)
    expect(r.hasMore).toBe(true)
    expect(r.preview.length).toBe(90)
    expect(r.preview.endsWith('c')).toBe(true)
    expect(r.preview).not.toContain('d')
  })

  test('huge content with frequent newlines uses last \\n in window', () => {
    // 200 lines of "ab\n" = 600 chars. maxBytes=100.
    // truncated = first 100 chars = lines "ab\n" * 33 + "a"
    // lastIndexOf '\n' in truncated = position 98 (after 33rd "ab\n")
    // 98 > 50 → cut at 98
    const content = 'ab\n'.repeat(200)
    const r = generatePreview(content, 100)
    expect(r.hasMore).toBe(true)
    expect(r.preview.length).toBe(98)
    expect(r.preview).toBe('ab\n'.repeat(33).slice(0, 98))
  })
})

describe('isToolResultContentEmpty — string content', () => {
  test('undefined content is empty', () => {
    expect(isToolResultContentEmpty(undefined)).toBe(true)
  })

  test('empty string is empty', () => {
    expect(isToolResultContentEmpty('')).toBe(true)
  })

  test('whitespace-only string is empty', () => {
    expect(isToolResultContentEmpty('   \t\n  ')).toBe(true)
  })

  test('string with content is NOT empty', () => {
    expect(isToolResultContentEmpty('hello')).toBe(false)
  })

  test('string with leading/trailing whitespace is NOT empty', () => {
    expect(isToolResultContentEmpty('  hello  ')).toBe(false)
  })
})

describe('isToolResultContentEmpty — array content', () => {
  test('empty array is empty', () => {
    expect(isToolResultContentEmpty([])).toBe(true)
  })

  test('array of empty text blocks is empty', () => {
    expect(
      isToolResultContentEmpty([
        { type: 'text', text: '' },
        { type: 'text', text: '   ' },
      ]),
    ).toBe(true)
  })

  test('array with one non-empty text block is NOT empty', () => {
    expect(
      isToolResultContentEmpty([
        { type: 'text', text: '' },
        { type: 'text', text: 'real' },
      ]),
    ).toBe(false)
  })

  test('array with image block is NOT empty (image is content)', () => {
    // The `every` check requires every block to be type='text' AND empty.
    // An image block fails `block.type === 'text'` → returns false.
    expect(
      isToolResultContentEmpty([
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'x' },
        },
      ]),
    ).toBe(false)
  })

  test('array with text and image: image alone counts as not-empty', () => {
    // `every` block must be empty text → presence of image fails the check.
    expect(
      isToolResultContentEmpty([
        { type: 'text', text: '' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'x' },
        },
      ]),
    ).toBe(false)
  })

  test('text block with non-string text is treated as empty', () => {
    // Documented branch: `typeof block.text !== 'string'` → empty.
    expect(
      isToolResultContentEmpty([{ type: 'text', text: undefined as never }]),
    ).toBe(true)
  })
})

describe('isPersistError — type guard', () => {
  test('error result returns true', () => {
    expect(isPersistError({ error: 'ENOSPC' })).toBe(true)
  })

  test('success result returns false', () => {
    expect(
      isPersistError({
        filepath: '/x',
        originalSize: 100,
        isJson: false,
        preview: 'foo',
        hasMore: false,
      }),
    ).toBe(false)
  })
})

describe('getPersistenceThreshold — opt-out / override / default', () => {
  test('Infinity declared limit is respected (hard opt-out)', () => {
    // Per docstring: Infinity = hard opt-out. Tool's maxResultSizeChars
    // = Infinity ⇒ never persist (Read tool reads back its own output).
    nextFlagValue = { someTool: 1000 } // even with override, Infinity wins
    expect(getPersistenceThreshold('someTool', Infinity)).toBe(Infinity)
  })

  test('NaN is treated as non-finite — passes through (hard opt-out)', () => {
    // !Number.isFinite(NaN) === true
    nextFlagValue = {}
    expect(getPersistenceThreshold('foo', NaN)).toBeNaN()
  })

  test('flag value is null — falls through to default (no crash)', () => {
    // The guard `typeof override === 'number'` rejects null.
    // Defensive comment in source: GrowthBook can serve null.
    nextFlagValue = null
    const result = getPersistenceThreshold('foo', 100_000)
    // 100000 vs DEFAULT_MAX_RESULT_SIZE_CHARS (whichever is smaller).
    // Without crashing.
    expect(typeof result).toBe('number')
  })

  test('flag value is wrong shape (string) — falls through to default', () => {
    nextFlagValue = 'not-an-object'
    expect(typeof getPersistenceThreshold('foo', 100_000)).toBe('number')
  })

  test('valid override is applied', () => {
    nextFlagValue = { specialTool: 42 }
    expect(getPersistenceThreshold('specialTool', 100_000)).toBe(42)
  })

  test('override = 0 is rejected (must be > 0)', () => {
    // Per source: `override > 0` check.
    nextFlagValue = { specialTool: 0 }
    const result = getPersistenceThreshold('specialTool', 50_000)
    expect(result).not.toBe(0)
  })

  test('override = -1 is rejected', () => {
    nextFlagValue = { specialTool: -1 }
    const result = getPersistenceThreshold('specialTool', 50_000)
    expect(result).not.toBe(-1)
  })

  test('override = Infinity is rejected (must be finite)', () => {
    nextFlagValue = { specialTool: Infinity }
    const result = getPersistenceThreshold('specialTool', 50_000)
    expect(result).not.toBe(Infinity)
  })

  test('declared > DEFAULT clamps to DEFAULT', () => {
    // Clamp: min(declared, DEFAULT). Without an override, the global
    // default wins for any tool that declares a higher cap.
    nextFlagValue = {}
    const result = getPersistenceThreshold('foo', 99_999_999)
    expect(result).toBeLessThan(99_999_999)
  })

  test('declared < DEFAULT keeps the lower declared limit', () => {
    nextFlagValue = {}
    expect(getPersistenceThreshold('foo', 1_000)).toBe(1_000)
  })
})

describe('buildLargeToolResultMessage — formatting', () => {
  test('includes filepath, original size, preview, and tags', () => {
    const msg = buildLargeToolResultMessage({
      filepath: '/tmp/result.txt',
      originalSize: 50_000,
      isJson: false,
      preview: 'first 2000 bytes\nof content',
      hasMore: true,
    })
    expect(msg).toContain('/tmp/result.txt')
    expect(msg).toContain('first 2000 bytes')
    // hasMore=true → trailing "..." marker
    expect(msg).toContain('...')
  })

  test('hasMore=false omits the "..." marker', () => {
    const msg = buildLargeToolResultMessage({
      filepath: '/tmp/result.txt',
      originalSize: 100,
      isJson: false,
      preview: 'short',
      hasMore: false,
    })
    expect(msg).not.toContain('...')
  })
})
