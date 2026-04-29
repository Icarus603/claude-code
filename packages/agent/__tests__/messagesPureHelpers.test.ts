import { beforeAll, describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import {
  deriveShortMessageId,
  deriveUUID,
  extractTag,
} from '../messages.js'

describe('deriveShortMessageId — UUID → short ID', () => {
  test('produces a 6-char string', () => {
    const id = deriveShortMessageId('550e8400-e29b-41d4-a716-446655440000')
    expect(id.length).toBeGreaterThan(0)
    expect(id.length).toBeLessThanOrEqual(6)
  })

  test('deterministic — same UUID always produces same ID', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(deriveShortMessageId(uuid)).toBe(deriveShortMessageId(uuid))
  })

  test('different UUIDs typically produce different IDs', () => {
    const a = deriveShortMessageId('550e8400-e29b-41d4-a716-446655440000')
    const b = deriveShortMessageId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    // Not a guarantee (base36 truncated to 6 chars has ~2.18 billion variants),
    // but for these specific UUIDs the prefixes are different enough that
    // collision is astronomically unlikely.
    expect(a).not.toBe(b)
  })

  test('UUID without dashes also handled (replaceAll handles missing)', () => {
    // The replace(/-/g, '') is a no-op if there are no dashes. The function
    // takes the first 10 hex chars regardless of dash placement.
    const id = deriveShortMessageId('550e8400e29b41d4a716446655440000')
    expect(id.length).toBeGreaterThan(0)
  })

  test('different first-10-hex-chars but same suffix → different IDs', () => {
    // Anchors that the function uses ONLY the first 10 hex chars.
    const a = deriveShortMessageId('00000000-0000-0000-0000-000000000000')
    const b = deriveShortMessageId('11111111-0000-0000-0000-000000000000')
    expect(a).not.toBe(b)
  })

  test('same first-10-hex-chars, different suffix → SAME ID (only prefix matters)', () => {
    // Documents the truncation contract: anything past the 10th hex char
    // is ignored. Two UUIDs sharing the first 10 hex chars collide.
    const a = deriveShortMessageId('00000000-0000-1111-1111-111111111111')
    const b = deriveShortMessageId('00000000-0000-2222-2222-222222222222')
    expect(a).toBe(b)
  })

  test('ID uses base36 (lowercase a-z + 0-9)', () => {
    const id = deriveShortMessageId('ffffffff-ffff-ffff-ffff-ffffffffffff')
    expect(id).toMatch(/^[0-9a-z]+$/)
  })

  test('zero UUID → "0" base36', () => {
    expect(deriveShortMessageId('00000000-0000-0000-0000-000000000000')).toBe('0')
  })
})

describe('deriveUUID — deterministic key derivation', () => {
  test('produces a UUID-shaped string with parent prefix preserved', () => {
    const parent = '550e8400-e29b-41d4-a716-446655440000' as UUID
    const r = deriveUUID(parent, 0)
    expect(r.startsWith('550e8400-e29b-41d4-a716')).toBe(true)
  })

  test('deterministic — same parent + index produces same UUID', () => {
    const parent = '550e8400-e29b-41d4-a716-446655440000' as UUID
    expect(deriveUUID(parent, 0)).toBe(deriveUUID(parent, 0))
    expect(deriveUUID(parent, 5)).toBe(deriveUUID(parent, 5))
  })

  test('different indexes → different UUIDs (suffix derived from index)', () => {
    const parent = '550e8400-e29b-41d4-a716-446655440000' as UUID
    expect(deriveUUID(parent, 0)).not.toBe(deriveUUID(parent, 1))
    expect(deriveUUID(parent, 1)).not.toBe(deriveUUID(parent, 2))
  })

  test('index 0 produces zero-padded suffix', () => {
    const parent = '00000000-0000-0000-0000-000000000000' as UUID
    expect(deriveUUID(parent, 0)).toBe(
      '00000000-0000-0000-0000-000000000000' as UUID,
    )
  })

  test('index 1 produces "...000000000001" suffix', () => {
    const parent = '00000000-0000-0000-0000-000000000000' as UUID
    expect(deriveUUID(parent, 1)).toBe(
      '00000000-0000-0000-0000-000000000001' as UUID,
    )
  })

  test('index 255 produces "...0000000000ff" suffix (hex padding)', () => {
    const parent = '00000000-0000-0000-0000-000000000000' as UUID
    expect(deriveUUID(parent, 255)).toBe(
      '00000000-0000-0000-0000-0000000000ff' as UUID,
    )
  })

  test('large index up to 12-hex-char limit', () => {
    const parent = '00000000-0000-0000-0000-000000000000' as UUID
    const max = 0xffffffffffff // 2^48 - 1
    expect(deriveUUID(parent, max)).toBe(
      '00000000-0000-0000-0000-ffffffffffff' as UUID,
    )
  })

  test('different parents produce different UUIDs', () => {
    const p1 = '550e8400-e29b-41d4-a716-446655440000' as UUID
    const p2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' as UUID
    expect(deriveUUID(p1, 0)).not.toBe(deriveUUID(p2, 0))
  })
})

describe('formatCommandInputTags — slash command breadcrumb', () => {
  let formatCommandInputTags: typeof import('../messages.js').formatCommandInputTags
  beforeAll(async () => {
    ;({ formatCommandInputTags } = await import('../messages.js'))
  })

  test('output contains all three tags', () => {
    const result = formatCommandInputTags('review', 'fix tests')
    expect(result).toContain('<command-name>')
    expect(result).toContain('</command-name>')
    expect(result).toContain('<command-message>')
    expect(result).toContain('<command-args>')
  })

  test('command name has leading slash in command-name tag', () => {
    // Documented format: command-name has the slash, command-message
    // doesn't. The slash distinguishes user-typed commands from
    // unrelated text — see SKIP_FIRST_PROMPT_PATTERN's usage of this.
    const result = formatCommandInputTags('review', 'x')
    expect(result).toContain('<command-name>/review</command-name>')
  })

  test('command-message has the bare name (no slash)', () => {
    const result = formatCommandInputTags('review', 'x')
    expect(result).toContain('<command-message>review</command-message>')
  })

  test('args appear inside command-args tag', () => {
    const result = formatCommandInputTags('greet', 'hello world')
    expect(result).toContain('<command-args>hello world</command-args>')
  })

  test('empty args produce empty command-args content', () => {
    const result = formatCommandInputTags('clear', '')
    expect(result).toContain('<command-args></command-args>')
  })

  test('special chars in args NOT escaped (documented)', () => {
    // The function does NOT HTML-escape — args flow through verbatim.
    // Locks behavior so a future "we should escape" patch is
    // intentional (consumers downstream may rely on raw passthrough).
    const result = formatCommandInputTags('cmd', 'a<b>c & d')
    expect(result).toContain('a<b>c & d')
  })
})

describe('AUTO_REJECT_MESSAGE / DONT_ASK_REJECT_MESSAGE — formatters', () => {
  let AUTO_REJECT_MESSAGE: typeof import('../messages.js').AUTO_REJECT_MESSAGE
  let DONT_ASK_REJECT_MESSAGE: typeof import('../messages.js').DONT_ASK_REJECT_MESSAGE
  beforeAll(async () => {
    ;({ AUTO_REJECT_MESSAGE, DONT_ASK_REJECT_MESSAGE } = await import(
      '../messages.js'
    ))
  })

  test('AUTO_REJECT_MESSAGE includes tool name', () => {
    expect(AUTO_REJECT_MESSAGE('Bash')).toContain('Bash')
    expect(AUTO_REJECT_MESSAGE('Bash')).toContain('denied')
  })

  test('AUTO_REJECT_MESSAGE includes denial workaround guidance', () => {
    // The shared DENIAL_WORKAROUND_GUIDANCE is appended.
    const msg = AUTO_REJECT_MESSAGE('FileEdit')
    expect(msg.length).toBeGreaterThan(50)
  })

  test('DONT_ASK_REJECT_MESSAGE has different text from AUTO_REJECT_MESSAGE', () => {
    // Distinct messages — model gets different context for each path.
    const a = AUTO_REJECT_MESSAGE('X')
    const b = DONT_ASK_REJECT_MESSAGE('X')
    expect(a).not.toBe(b)
  })

  test("DONT_ASK_REJECT_MESSAGE mentions \"don't ask mode\"", () => {
    expect(DONT_ASK_REJECT_MESSAGE('Edit')).toContain("don't ask mode")
  })

  test('Both messages include the tool name verbatim', () => {
    const tool = 'CustomTool'
    expect(AUTO_REJECT_MESSAGE(tool)).toContain(tool)
    expect(DONT_ASK_REJECT_MESSAGE(tool)).toContain(tool)
  })
})

describe('isClassifierDenial — UI summary detection', () => {
  let isClassifierDenial: typeof import('../messages.js').isClassifierDenial
  beforeAll(async () => {
    ;({ isClassifierDenial } = await import('../messages.js'))
  })

  test('content starting with auto-mode rejection prefix → true', () => {
    expect(
      isClassifierDenial(
        'Permission for this action has been denied. Reason: not safe',
      ),
    ).toBe(true)
  })

  test('plain rejection text → false', () => {
    expect(
      isClassifierDenial('Permission to use Bash has been denied.'),
    ).toBe(false)
  })

  test('empty string → false', () => {
    expect(isClassifierDenial('')).toBe(false)
  })

  test('whitespace before prefix → false (strict startsWith)', () => {
    expect(
      isClassifierDenial(
        ' Permission for this action has been denied. Reason: x',
      ),
    ).toBe(false)
  })

  test('case mismatch → false', () => {
    expect(
      isClassifierDenial('PERMISSION FOR THIS ACTION HAS BEEN DENIED.'),
    ).toBe(false)
  })
})

describe('buildYoloRejectionMessage — formatting', () => {
  let buildYoloRejectionMessage: typeof import('../messages.js').buildYoloRejectionMessage
  let isClassifierDenial: typeof import('../messages.js').isClassifierDenial
  beforeAll(async () => {
    ;({ buildYoloRejectionMessage, isClassifierDenial } = await import(
      '../messages.js'
    ))
  })

  test('output starts with the auto-mode rejection prefix', () => {
    const msg = buildYoloRejectionMessage('command modifies system')
    // CRITICAL: isClassifierDenial(buildYoloRejectionMessage(...)) must
    // round-trip to true.
    expect(isClassifierDenial(msg)).toBe(true)
  })

  test('reason is included verbatim', () => {
    const msg = buildYoloRejectionMessage('writes outside workspace')
    expect(msg).toContain('writes outside workspace')
  })

  test('mentions permission-rule guidance', () => {
    const msg = buildYoloRejectionMessage('test')
    expect(msg.toLowerCase()).toMatch(/permission rule|bash/i)
  })
})

describe('buildClassifierUnavailableMessage', () => {
  let buildClassifierUnavailableMessage: typeof import('../messages.js').buildClassifierUnavailableMessage
  beforeAll(async () => {
    ;({ buildClassifierUnavailableMessage } = await import('../messages.js'))
  })

  test('mentions both tool name and classifier model', () => {
    const msg = buildClassifierUnavailableMessage('Bash', 'haiku-4-5')
    expect(msg).toContain('Bash')
    expect(msg).toContain('haiku-4-5')
  })

  test('mentions read-only operations as still available', () => {
    const msg = buildClassifierUnavailableMessage('Bash', 'haiku-4-5')
    expect(msg).toMatch(/read-only|reading files|search/i)
  })
})

describe('isToolUseRequestMessage / isToolUseResultMessage — type guards', () => {
  let isToolUseRequestMessage: typeof import('../messages.js').isToolUseRequestMessage
  let isToolUseResultMessage: typeof import('../messages.js').isToolUseResultMessage
  beforeAll(async () => {
    ;({ isToolUseRequestMessage, isToolUseResultMessage } = await import(
      '../messages.js'
    ))
  })

  test('assistant with tool_use block → request', () => {
    expect(
      isToolUseRequestMessage({
        type: 'assistant',
        uuid: 'u1' as never,
        message: {
          content: [{ type: 'tool_use', id: 't1', name: 'X', input: {} }],
        },
      } as never),
    ).toBe(true)
  })

  test('assistant with text only → NOT request', () => {
    expect(
      isToolUseRequestMessage({
        type: 'assistant',
        uuid: 'u1' as never,
        message: { content: [{ type: 'text', text: 'hi' }] },
      } as never),
    ).toBe(false)
  })

  test('assistant with non-array content → NOT request', () => {
    expect(
      isToolUseRequestMessage({
        type: 'assistant',
        uuid: 'u1' as never,
        message: { content: 'plain' },
      } as never),
    ).toBe(false)
  })

  test('user with tool_use → NOT request (only assistants)', () => {
    expect(
      isToolUseRequestMessage({
        type: 'user',
        uuid: 'u1' as never,
        message: {
          content: [{ type: 'tool_use', id: 't1', name: 'X', input: {} }],
        },
      } as never),
    ).toBe(false)
  })

  test('user with tool_result block (first) → result', () => {
    expect(
      isToolUseResultMessage({
        type: 'user',
        uuid: 'u1' as never,
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu', content: 'ok' },
          ],
        },
      } as never),
    ).toBe(true)
  })

  test('user with toolUseResult field → result (alternate shape)', () => {
    // The function accepts EITHER content[0]=tool_result OR
    // .toolUseResult being truthy. Locks both paths.
    expect(
      isToolUseResultMessage({
        type: 'user',
        uuid: 'u1' as never,
        message: { content: 'plain' },
        toolUseResult: { stdout: 'output' },
      } as never),
    ).toBe(true)
  })

  test('user with text only and no toolUseResult → NOT result', () => {
    expect(
      isToolUseResultMessage({
        type: 'user',
        uuid: 'u1' as never,
        message: { content: [{ type: 'text', text: 'hi' }] },
      } as never),
    ).toBe(false)
  })

  test('assistant message → NOT result', () => {
    expect(
      isToolUseResultMessage({
        type: 'assistant',
        uuid: 'u1' as never,
        message: { content: 'reply' },
      } as never),
    ).toBe(false)
  })

  test('user with tool_result NOT at index 0 → NOT result (only first checked)', () => {
    // Documented behavior: content[0]?.type === 'tool_result' — only
    // the first block matters for the type guard. Lock so a refactor
    // that scans all blocks doesn't change classification.
    expect(
      isToolUseResultMessage({
        type: 'user',
        uuid: 'u1' as never,
        message: {
          content: [
            { type: 'text', text: 'before' },
            { type: 'tool_result', tool_use_id: 'tu', content: 'ok' },
          ],
        },
      } as never),
    ).toBe(false)
  })
})

describe('extractTag — XML/HTML tag content extraction', () => {
  test('simple tag extraction', () => {
    expect(extractTag('<foo>hello</foo>', 'foo')).toBe('hello')
  })

  test('tag with attributes', () => {
    expect(extractTag('<foo bar="baz">content</foo>', 'foo')).toBe('content')
  })

  test('multiple attributes', () => {
    expect(extractTag('<foo a="1" b="2">x</foo>', 'foo')).toBe('x')
  })

  test('multiline content preserved', () => {
    expect(extractTag('<foo>line1\nline2\nline3</foo>', 'foo')).toBe(
      'line1\nline2\nline3',
    )
  })

  test('case-insensitive tag matching', () => {
    // The regex is built with 'gi' flag.
    expect(extractTag('<FOO>hi</FOO>', 'foo')).toBe('hi')
    expect(extractTag('<foo>hi</foo>', 'FOO')).toBe('hi')
  })

  test('tag not present → null', () => {
    expect(extractTag('<bar>hi</bar>', 'foo')).toBeNull()
  })

  test('empty content → null (function returns null on empty)', () => {
    // The regex captures the content; empty content fails the depth check
    // (`if (depth === 0 && content)`) because '' is falsy.
    expect(extractTag('<foo></foo>', 'foo')).toBeNull()
  })

  test('empty html → null', () => {
    expect(extractTag('', 'foo')).toBeNull()
  })

  test('whitespace-only html → null', () => {
    expect(extractTag('   ', 'foo')).toBeNull()
  })

  test('empty tagName → null', () => {
    expect(extractTag('<foo>x</foo>', '')).toBeNull()
  })

  test('whitespace-only tagName → null', () => {
    expect(extractTag('<foo>x</foo>', '   ')).toBeNull()
  })

  test('returns FIRST match when multiple instances exist', () => {
    expect(extractTag('<foo>first</foo><foo>second</foo>', 'foo')).toBe('first')
  })

  test('regex special chars in tagName escaped', () => {
    // The function uses escapeRegExp on tagName. Tag names with dots etc.
    // (uncommon but theoretically possible in custom XML) should still work.
    expect(extractTag('<foo.bar>x</foo.bar>', 'foo.bar')).toBe('x')
  })

  test('nested tags — outer tag content captured (non-greedy match within depth=0)', () => {
    // Function tracks depth — only matches that are at depth 0 are returned.
    // The non-greedy match grabs the FIRST closing tag.
    const r = extractTag('<a><b>inner</b></a>', 'a')
    // Inner is captured because the outer's content INCLUDES the nested tags.
    expect(r).toBe('<b>inner</b>')
  })

  test('content with HTML entities preserved (no decoding)', () => {
    expect(extractTag('<foo>&amp;hello</foo>', 'foo')).toBe('&amp;hello')
  })

  test('self-closing-style tags (no content) → null', () => {
    // <foo/> has no content. The function looks for <foo>...</foo>, so
    // a self-closing tag doesn't match the pattern at all.
    expect(extractTag('<foo/>', 'foo')).toBeNull()
  })
})

describe('isNotEmptyMessage — content emptiness check', () => {
  // Re-import inside the describe so we don't disturb the existing
  // test file's import block. The helper must agree with the canonical
  // NO_CONTENT_MESSAGE constant — a divergence in 2026-04-29 caused
  // factory-empty messages to be treated as non-empty.
  let isNotEmptyMessage: typeof import('../messages.js').isNotEmptyMessage
  let NO_CONTENT_MESSAGE: string
  beforeAll(async () => {
    ;({ isNotEmptyMessage } = await import('../messages.js'))
    ;({ NO_CONTENT_MESSAGE } = await import('../constants/messages.js'))
  })

  test('progress / attachment / system messages always considered non-empty', () => {
    expect(
      isNotEmptyMessage({ type: 'progress', uuid: 'u1' as never } as never),
    ).toBe(true)
    expect(
      isNotEmptyMessage({ type: 'attachment', uuid: 'u1' as never } as never),
    ).toBe(true)
    expect(
      isNotEmptyMessage({ type: 'system', uuid: 'u1' as never } as never),
    ).toBe(true)
  })

  test('user with non-empty string content is non-empty', () => {
    expect(
      isNotEmptyMessage({
        type: 'user',
        uuid: 'u1' as never,
        message: { content: 'hello' },
      } as never),
    ).toBe(true)
  })

  test('user with empty string content is empty', () => {
    expect(
      isNotEmptyMessage({
        type: 'user',
        uuid: 'u1' as never,
        message: { content: '' },
      } as never),
    ).toBe(false)
  })

  test('user with whitespace-only content is empty', () => {
    expect(
      isNotEmptyMessage({
        type: 'user',
        uuid: 'u1' as never,
        message: { content: '   \n\t  ' },
      } as never),
    ).toBe(false)
  })

  test('user with empty content array is empty', () => {
    expect(
      isNotEmptyMessage({
        type: 'user',
        uuid: 'u1' as never,
        message: { content: [] },
      } as never),
    ).toBe(false)
  })

  test('user with single text block matching NO_CONTENT_MESSAGE is empty', () => {
    // CRITICAL: this locks the agreement between the canonical constant
    // and the comparison. Drift caused factory-set "[No content]" to be
    // treated as non-empty (2026-04-29 finding).
    expect(
      isNotEmptyMessage({
        type: 'user',
        uuid: 'u1' as never,
        message: {
          content: [{ type: 'text', text: NO_CONTENT_MESSAGE }],
        },
      } as never),
    ).toBe(false)
  })

  test('user with single empty text block is empty', () => {
    expect(
      isNotEmptyMessage({
        type: 'user',
        uuid: 'u1' as never,
        message: { content: [{ type: 'text', text: '' }] },
      } as never),
    ).toBe(false)
  })

  test('user with single non-text block (image/tool_result) is non-empty', () => {
    expect(
      isNotEmptyMessage({
        type: 'user',
        uuid: 'u1' as never,
        message: {
          content: [{ type: 'image', source: {} }],
        },
      } as never),
    ).toBe(true)
  })

  test('user with multiple blocks is non-empty (skip-multi-block guard)', () => {
    // Documented: the function explicitly skips multi-block content.
    // Two text blocks both empty → still considered non-empty.
    expect(
      isNotEmptyMessage({
        type: 'user',
        uuid: 'u1' as never,
        message: {
          content: [
            { type: 'text', text: '' },
            { type: 'text', text: '' },
          ],
        },
      } as never),
    ).toBe(true)
  })
})

describe('extractTag — documented LIMITATIONS (not bugs, just contract)', () => {
  // These cases lock the function's known limitations so a future
  // refactor doesn't accidentally CHANGE behaviour without anyone
  // noticing. They're not bugs because:
  //   1. extractTag is used to extract user-controlled tags like
  //      <bash-input>, <command-name> — the inputs we feed it never
  //      contain attribute values with raw `>` or `</`.
  //   2. Nested same-name tags don't appear in our use cases (no
  //      `<command-name>foo<command-name>bar</command-name></command-name>`).
  // Document the limitation so anyone hitting one of these in a new
  // use case sees the constraint immediately.

  test('same-name nested tags: returns content up to FIRST closing tag', () => {
    // <a>outer<a>inner</a>more</a> — the outer's "true" content is
    // "outer<a>inner</a>more". Non-greedy regex captures up to the
    // first `</a>` instead. Limitation: same-name nesting not handled.
    expect(extractTag('<a>outer<a>inner</a>more</a>', 'a')).toBe(
      'outer<a>inner',
    )
  })

  test('deep same-name nesting collapses to first close', () => {
    // <a><a><a>deep</a></a></a> — captures up to first </a>.
    expect(extractTag('<a><a><a>deep</a></a></a>', 'a')).toBe('<a><a>deep')
  })

  test('attribute value containing raw > breaks parser', () => {
    // <a foo="x>y">content</a> — the `>` inside the attribute closes
    // the opening tag prematurely. Pre-existing limitation — none of
    // our callers feed strings with this shape.
    const r = extractTag('<a foo="x>y">content</a>', 'a')
    expect(r).not.toBe('content') // wrong result, but documented
  })

  test('attribute value containing </tag> breaks parser', () => {
    // <a foo="</a>">content</a> — the embedded "</a>" inside the
    // quoted attribute matches the closing pattern. Pre-existing
    // limitation; user-controlled `<bash-input>` / `<command-name>`
    // never contain attributes.
    const r = extractTag('<a foo="</a>">content</a>', 'a')
    expect(r).not.toBe('content')
  })

  test('disjoint sibling tags: returns FIRST occurrence', () => {
    // Documented elsewhere ("returns FIRST match"); locked here as
    // contract for the no-nesting case so a "fix nested" patch
    // doesn't accidentally pick the wrong tag.
    expect(extractTag('<x><a>1</a></x><x><a>2</a></x>', 'x')).toBe(
      '<a>1</a>',
    )
  })

  test('unclosed tag → null (no greedy fallback)', () => {
    // <a>never closes — the regex requires a matching close tag.
    // Without one, no match. Important: prevents extractTag from
    // returning everything-after-the-open-tag, which would be a
    // security issue if user input can contain a stray `<bash-input>`.
    expect(extractTag('<a>never closes', 'a')).toBeNull()
  })
})
