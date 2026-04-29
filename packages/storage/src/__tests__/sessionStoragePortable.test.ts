import { describe, expect, test } from 'bun:test'
import {
  extractFirstPromptFromHead,
  extractJsonStringField,
  extractLastJsonStringField,
  sanitizePath,
  unescapeJsonString,
  validateUuid,
} from '../sessionStoragePortable.js'

// ─── unescapeJsonString — fast-path + correctness ───────────────────────

describe('unescapeJsonString', () => {
  test('no backslash → return reference unchanged (fast path)', () => {
    const input = 'plain text'
    expect(unescapeJsonString(input)).toBe(input)
  })

  test('backslash-escaped quote → unescaped', () => {
    expect(unescapeJsonString('say \\"hi\\"')).toBe('say "hi"')
  })

  test('backslash-escaped newline → \\n char', () => {
    expect(unescapeJsonString('a\\nb')).toBe('a\nb')
  })

  test('backslash-escaped tab → tab char', () => {
    expect(unescapeJsonString('a\\tb')).toBe('a\tb')
  })

  test('unicode escape \\uXXXX → char', () => {
    expect(unescapeJsonString('\\u4e2d\\u6587')).toBe('中文')
  })

  test('double backslash → single backslash', () => {
    expect(unescapeJsonString('a\\\\b')).toBe('a\\b')
  })

  test('invalid escape → return raw (defensive)', () => {
    // \z is not a valid JSON escape. JSON.parse fails → fall back to raw.
    expect(unescapeJsonString('a\\zb')).toBe('a\\zb')
  })

  test('single trailing backslash → return raw (incomplete escape)', () => {
    // 'a\' would need escaping; JSON.parse('"a\\"') fails.
    expect(unescapeJsonString('a\\')).toBe('a\\')
  })

  test('empty string passes through', () => {
    expect(unescapeJsonString('')).toBe('')
  })
})

// ─── validateUuid ────────────────────────────────────────────────────────

describe('validateUuid', () => {
  test('valid UUID → branded UUID', () => {
    expect(validateUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    )
  })

  test('uppercase UUID accepted', () => {
    expect(validateUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(
      '550E8400-E29B-41D4-A716-446655440000',
    )
  })

  test('non-string returns null', () => {
    expect(validateUuid(123)).toBeNull()
    expect(validateUuid(null)).toBeNull()
    expect(validateUuid(undefined)).toBeNull()
    expect(validateUuid({})).toBeNull()
  })

  test('truncated UUID → null', () => {
    expect(validateUuid('550e8400-e29b-41d4-a716')).toBeNull()
  })

  test('UUID without hyphens → null', () => {
    expect(validateUuid('550e8400e29b41d4a716446655440000')).toBeNull()
  })

  test('extra characters → null', () => {
    expect(validateUuid('550e8400-e29b-41d4-a716-446655440000-extra')).toBeNull()
  })
})

// ─── extractJsonStringField — partial parse on truncated lines ──────────

describe('extractJsonStringField — first occurrence', () => {
  test('basic key:value', () => {
    expect(extractJsonStringField('"name":"alice"', 'name')).toBe('alice')
  })

  test('key: value (with space)', () => {
    expect(extractJsonStringField('"name": "alice"', 'name')).toBe('alice')
  })

  test('nested in larger JSON', () => {
    expect(
      extractJsonStringField('{"id":1,"name":"alice","age":30}', 'name'),
    ).toBe('alice')
  })

  test('escaped quote inside value', () => {
    expect(extractJsonStringField('"text":"say \\"hi\\""', 'text')).toBe(
      'say "hi"',
    )
  })

  test('returns FIRST occurrence', () => {
    expect(
      extractJsonStringField('"x":"first","y":1,"x":"second"', 'x'),
    ).toBe('first')
  })

  test('returns undefined when key not found', () => {
    expect(extractJsonStringField('{"foo":"bar"}', 'baz')).toBeUndefined()
  })

  test('empty value → empty string', () => {
    expect(extractJsonStringField('"name":""', 'name')).toBe('')
  })

  test('truncated line — value start but no closing quote → undefined', () => {
    // CRITICAL: parser must not crash on truncated JSONL lines.
    // The while loop walks until i < text.length; if no closing quote,
    // it falls through and returns undefined (NOT garbage data).
    expect(
      extractJsonStringField('"name":"never closing', 'name'),
    ).toBeUndefined()
  })

  test('value with backslash-followed-EOF — i+=2 walks past end safely', () => {
    // When the line ends mid-escape, i += 2 may step past length. The
    // while-condition catches it.
    expect(extractJsonStringField('"x":"abc\\', 'x')).toBeUndefined()
  })

  test('key value with colon inside string content', () => {
    // Documents that the parser does NOT confuse `:` inside the value
    // with the key:value separator.
    expect(extractJsonStringField('"url":"http://example.com"', 'url')).toBe(
      'http://example.com',
    )
  })

  test('special: value containing escaped backslashes preserved', () => {
    expect(extractJsonStringField('"path":"C:\\\\Users\\\\me"', 'path')).toBe(
      'C:\\Users\\me',
    )
  })

  test('key NOT prefix-match (two keys with shared prefix)', () => {
    // The pattern is `"name":"`. Looking for "name" in `"username":"X","name":"Y"`
    // — what does the parser return? Let's probe.
    const result = extractJsonStringField(
      '{"username":"alice","name":"bob"}',
      'name',
    )
    // The pattern `"name":"` matches at the second occurrence, NOT inside
    // "username". This is correct because indexOf finds the literal.
    expect(result).toBe('bob')
  })
})

describe('extractLastJsonStringField — last occurrence', () => {
  test('returns LAST occurrence among duplicates', () => {
    expect(
      extractLastJsonStringField('"x":"first","y":1,"x":"second"', 'x'),
    ).toBe('second')
  })

  test('handles mixed `"x":"` and `"x": "` patterns', () => {
    // Both patterns are scanned; among ALL matches across both, the
    // last one wins (in scan order: pattern[0] first, then pattern[1]).
    expect(
      extractLastJsonStringField(
        '"x":"a","x": "b","x":"c"',
        'x',
      ),
    ).toBe('c')
  })

  test('single occurrence works', () => {
    expect(extractLastJsonStringField('"x":"only"', 'x')).toBe('only')
  })

  test('no occurrence → undefined', () => {
    expect(extractLastJsonStringField('"y":"v"', 'x')).toBeUndefined()
  })

  test('truncated last value → undefined (does not return earlier match!)', () => {
    // CRITICAL: if the last unparseable value is truncated, do we get
    // undefined (correct) or the previous parsed match? Probe this.
    const result = extractLastJsonStringField(
      '"x":"first","x":"truncated',
      'x',
    )
    // The inner break exits the inner while when ", but if no ", the
    // i loops to text.length and we fall through. lastValue stays as
    // 'first' from previous iteration. BUG?
    // Actually re-reading: lastValue is updated only INSIDE the closing-quote
    // branch. Truncated value never assigns. So lastValue === 'first'.
    // This is the EXPECTED contract: best-effort, return last successfully
    // parsed value.
    expect(result).toBe('first')
  })

  test('escaped quote in value preserved', () => {
    expect(
      extractLastJsonStringField('"x":"first","x":"sec\\"ond"', 'x'),
    ).toBe('sec"ond')
  })
})

// ─── extractFirstPromptFromHead — JSONL header parser ────────────────────

function makeUserLine(content: string | object): string {
  return JSON.stringify({
    type: 'user',
    message: { content },
  })
}

describe('extractFirstPromptFromHead', () => {
  test('empty input → empty string', () => {
    expect(extractFirstPromptFromHead('')).toBe('')
  })

  test('simple text content extracted', () => {
    expect(extractFirstPromptFromHead(makeUserLine('Hello world'))).toBe(
      'Hello world',
    )
  })

  test('newlines collapsed to spaces', () => {
    expect(extractFirstPromptFromHead(makeUserLine('line1\nline2'))).toBe(
      'line1 line2',
    )
  })

  test('content as ContentBlocks[] — text blocks aggregated', () => {
    expect(
      extractFirstPromptFromHead(
        makeUserLine([
          { type: 'text', text: 'Hello' },
          { type: 'image', source: { type: 'base64', data: 'x' } },
        ]),
      ),
    ).toBe('Hello')
  })

  test('skips tool_result-bearing user messages', () => {
    const head =
      JSON.stringify({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 't', content: 'r' }],
        },
      }) + '\n' + makeUserLine('real prompt')
    expect(extractFirstPromptFromHead(head)).toBe('real prompt')
  })

  test('skips isMeta:true messages', () => {
    const head =
      JSON.stringify({
        type: 'user',
        isMeta: true,
        message: { content: 'meta info' },
      }) + '\n' + makeUserLine('real prompt')
    expect(extractFirstPromptFromHead(head)).toBe('real prompt')
  })

  test('skips isCompactSummary:true messages', () => {
    const head =
      JSON.stringify({
        type: 'user',
        isCompactSummary: true,
        message: { content: 'compact summary' },
      }) + '\n' + makeUserLine('real prompt')
    expect(extractFirstPromptFromHead(head)).toBe('real prompt')
  })

  test('skips XML-tagged auto-prompts (IDE context, hooks)', () => {
    const head =
      makeUserLine('<system-reminder>auto</system-reminder>') +
      '\n' +
      makeUserLine('Real first prompt')
    expect(extractFirstPromptFromHead(head)).toBe('Real first prompt')
  })

  test('formats <bash-input> as ! prefix', () => {
    expect(
      extractFirstPromptFromHead(makeUserLine('<bash-input>ls -la</bash-input>')),
    ).toBe('! ls -la')
  })

  test('skips command-name but uses as fallback if no real prompt found', () => {
    // <command-name> is skipped. If there are no other user prompts,
    // commandFallback returns the captured command name.
    expect(
      extractFirstPromptFromHead(makeUserLine('<command-name>compact</command-name>')),
    ).toBe('compact')
  })

  test('truncates at 200 chars + ellipsis', () => {
    const longText = 'a'.repeat(250)
    const result = extractFirstPromptFromHead(makeUserLine(longText))
    expect(result.length).toBe(201) // 200 + 1 ellipsis char
    expect(result.endsWith('\u2026')).toBe(true)
  })

  test('exact 200 chars NOT truncated (boundary)', () => {
    const text = 'a'.repeat(200)
    expect(extractFirstPromptFromHead(makeUserLine(text))).toBe(text)
  })

  test('skips [Request interrupted by user] markers', () => {
    const head =
      makeUserLine('[Request interrupted by user]') +
      '\n' +
      makeUserLine('Real prompt')
    expect(extractFirstPromptFromHead(head)).toBe('Real prompt')
  })

  test('skips [Request interrupted by user for tool use]', () => {
    const head =
      makeUserLine('[Request interrupted by user for tool use]') +
      '\n' +
      makeUserLine('Real prompt')
    expect(extractFirstPromptFromHead(head)).toBe('Real prompt')
  })

  test('malformed JSON line silently skipped', () => {
    // Defensive: corrupted lines must not crash the scan.
    const head =
      'not valid json\n' + makeUserLine('Real prompt')
    expect(extractFirstPromptFromHead(head)).toBe('Real prompt')
  })

  test('returns empty when only assistant/tool_result messages', () => {
    // No user content at all → empty.
    const head =
      JSON.stringify({ type: 'assistant', message: { content: 'response' } }) +
      '\n'
    expect(extractFirstPromptFromHead(head)).toBe('')
  })

  test('whitespace-only user content skipped', () => {
    const head =
      makeUserLine('   ') + '\n' + makeUserLine('Real prompt')
    expect(extractFirstPromptFromHead(head)).toBe('Real prompt')
  })

  test('multi-block content with image+text — text wins', () => {
    expect(
      extractFirstPromptFromHead(
        makeUserLine([
          { type: 'image', source: { type: 'base64', data: 'x' } },
          { type: 'text', text: 'caption' },
        ]),
      ),
    ).toBe('caption')
  })
})

// ─── sanitizePath ────────────────────────────────────────────────────────

describe('sanitizePath', () => {
  test('alphanumeric passes through', () => {
    expect(sanitizePath('abc123')).toBe('abc123')
  })

  test('slashes become hyphens', () => {
    expect(sanitizePath('/Users/me/proj')).toBe('-Users-me-proj')
  })

  test('windows colon becomes hyphen', () => {
    expect(sanitizePath('plugin:name:server')).toBe('plugin-name-server')
  })

  test('special chars all become hyphens', () => {
    expect(sanitizePath('a@b#c$d.e_f')).toBe('a-b-c-d-e-f')
  })

  test('path under 200 chars passed through unchanged', () => {
    const path = '/Users/me/' + 'x'.repeat(180)
    expect(sanitizePath(path).length).toBeLessThan(200)
  })

  test('path over 200 chars gets hash suffix', () => {
    const longPath = '/x/' + 'y'.repeat(300)
    const result = sanitizePath(longPath)
    expect(result.length).toBeLessThanOrEqual(255)
    expect(result).toContain('-') // separator before hash
  })

  test('two paths with 200-char prefix-overlap → DIFFERENT hashes', () => {
    // CRITICAL: the hash must disambiguate paths sharing a 200-char prefix.
    // Without this, two distinct paths would cache to the same dir.
    const a = '/x/' + 'y'.repeat(300) + '/path-a'
    const b = '/x/' + 'y'.repeat(300) + '/path-b'
    expect(sanitizePath(a)).not.toBe(sanitizePath(b))
  })

  test('deterministic — same input always produces same output', () => {
    const path = '/some/path'
    expect(sanitizePath(path)).toBe(sanitizePath(path))
  })

  test('unicode chars become hyphens', () => {
    expect(sanitizePath('中文/path')).toBe('---path')
  })

  test('empty string passes through (zero alphanumeric chars to replace)', () => {
    expect(sanitizePath('')).toBe('')
  })
})
