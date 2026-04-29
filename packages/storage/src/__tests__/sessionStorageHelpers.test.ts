/**
 * Tests for sessionStorage pure helpers — focused on the logic that builds
 * session display titles ("first prompt") and serializes transcripts to disk.
 *
 * Why this matters: a wrong "first prompt" makes the session list show
 * `<ide_selection>...` or `[Request interrupted by user]` instead of the
 * actual user prompt. Wrong serialization persists `parentUuid` /
 * `isSidechain` to disk, which then gets re-loaded and forms phantom chains.
 *
 * Both functions are exported and called on every session
 * load + every transcript flush — high-frequency code path.
 */
import { describe, expect, mock, test } from 'bun:test'
import type { UUID } from 'crypto'

// builtInCommandNames is module-state-heavy and triggers
// ensureCommandRuntimeInstalled() under the hood. Mock it so tests stay
// hermetic and don't drag in the full command-runtime graph.
//
// Spread the real module so other named exports (getSkillToolCommands,
// findCommand, etc.) keep working — only override the one symbol we care
// about for these tests.
const BUILT_IN_NAMES = new Set([
  'model',
  'clear',
  'help',
  'exit',
  'compact',
])

const realRuntime = await import('@claude-code/command-runtime/runtime')
mock.module('@claude-code/command-runtime/runtime', () => ({
  ...realRuntime,
  builtInCommandNames: () => BUILT_IN_NAMES,
}))

const { getFirstMeaningfulUserMessageTextContent, removeExtraFields } =
  await import('../sessionStorage.js')

type Msg = Parameters<typeof getFirstMeaningfulUserMessageTextContent>[0][number]

function user(content: unknown, extra: Partial<Msg> = {}): Msg {
  return {
    type: 'user',
    uuid: '00000000-0000-0000-0000-000000000001' as UUID,
    message: { role: 'user', content: content as never },
    ...extra,
  } as Msg
}

function assistant(content: unknown, extra: Partial<Msg> = {}): Msg {
  return {
    type: 'assistant',
    uuid: '00000000-0000-0000-0000-000000000002' as UUID,
    message: { role: 'assistant', content: content as never },
    ...extra,
  } as Msg
}

describe('getFirstMeaningfulUserMessageTextContent — basic shapes', () => {
  test('plain string content returns as-is', () => {
    expect(
      getFirstMeaningfulUserMessageTextContent([user('hello world')]),
    ).toBe('hello world')
  })

  test('array text-block content returns first text', () => {
    const msg = user([
      { type: 'text', text: 'first block' },
      { type: 'text', text: 'second block' },
    ])
    expect(getFirstMeaningfulUserMessageTextContent([msg])).toBe('first block')
  })

  test('empty transcript returns undefined', () => {
    expect(getFirstMeaningfulUserMessageTextContent([])).toBeUndefined()
  })

  test('no user messages → undefined', () => {
    expect(
      getFirstMeaningfulUserMessageTextContent([assistant('hi')]),
    ).toBeUndefined()
  })

  test('skips assistant before first user', () => {
    const t = [assistant('reply'), user('real prompt')]
    expect(getFirstMeaningfulUserMessageTextContent(t)).toBe('real prompt')
  })
})

describe('getFirstMeaningfulUserMessageTextContent — meta filters', () => {
  test('isMeta=true user is skipped', () => {
    const t = [user('skip me', { isMeta: true }), user('real prompt')]
    expect(getFirstMeaningfulUserMessageTextContent(t)).toBe('real prompt')
  })

  test('isCompactSummary=true is skipped', () => {
    const t = [
      user('compaction summary', { isCompactSummary: true }),
      user('real prompt'),
    ]
    expect(getFirstMeaningfulUserMessageTextContent(t)).toBe('real prompt')
  })

  test('null/missing content is skipped', () => {
    const t = [
      { type: 'user', uuid: 'u1' as UUID, message: undefined } as Msg,
      user('real prompt'),
    ]
    expect(getFirstMeaningfulUserMessageTextContent(t)).toBe('real prompt')
  })
})

describe('getFirstMeaningfulUserMessageTextContent — built-in commands', () => {
  test('built-in command (no args) is skipped', () => {
    const t = [
      user('<command-name>/model</command-name>'),
      user('real prompt'),
    ]
    expect(getFirstMeaningfulUserMessageTextContent(t)).toBe('real prompt')
  })

  test('built-in command with args is STILL skipped', () => {
    // /model sonnet — built-in commands are skipped regardless of args
    // because the args are command-specific and not user-meaningful.
    const t = [
      user(
        '<command-name>/model</command-name><command-args>sonnet</command-args>',
      ),
      user('real prompt'),
    ]
    expect(getFirstMeaningfulUserMessageTextContent(t)).toBe('real prompt')
  })
})

describe('getFirstMeaningfulUserMessageTextContent — custom commands', () => {
  test('custom command (no args) is skipped', () => {
    // No args → not meaningful, fall through to next message.
    const t = [
      user('<command-name>/review</command-name>'),
      user('real prompt'),
    ]
    expect(getFirstMeaningfulUserMessageTextContent(t)).toBe('real prompt')
  })

  test('custom command with args returns "name args"', () => {
    const t = [
      user(
        '<command-name>/review</command-name><command-args>fix tests</command-args>',
      ),
    ]
    expect(getFirstMeaningfulUserMessageTextContent(t)).toBe(
      '/review fix tests',
    )
  })

  test('custom command with whitespace-only args is skipped', () => {
    const t = [
      user(
        '<command-name>/review</command-name><command-args>   </command-args>',
      ),
      user('fallback'),
    ]
    expect(getFirstMeaningfulUserMessageTextContent(t)).toBe('fallback')
  })
})

describe('getFirstMeaningfulUserMessageTextContent — bash mode', () => {
  test('bash-input gets "! prefix" formatting', () => {
    expect(
      getFirstMeaningfulUserMessageTextContent([
        user('<bash-input>ls -la</bash-input>'),
      ]),
    ).toBe('! ls -la')
  })

  test('bash-input takes precedence over XML-skip pattern', () => {
    // Even though <bash-input>... matches the SKIP_FIRST_PROMPT_PATTERN
    // (starts with <), the bash-mode check runs first.
    expect(
      getFirstMeaningfulUserMessageTextContent([
        user('<bash-input>echo hi</bash-input>'),
      ]),
    ).toBe('! echo hi')
  })
})

describe('getFirstMeaningfulUserMessageTextContent — IDE metadata multi-block', () => {
  test('IDE metadata blocks are walked past to real prompt', () => {
    // VS Code injects ide_selection / ide_opened_file BEFORE the user's
    // actual prompt. Both blocks are in the same content array.
    const msg = user([
      { type: 'text', text: '<ide_selection>line 5-10</ide_selection>' },
      { type: 'text', text: '<ide_opened_file>foo.ts</ide_opened_file>' },
      { type: 'text', text: 'fix the bug here' },
    ])
    expect(getFirstMeaningfulUserMessageTextContent([msg])).toBe(
      'fix the bug here',
    )
  })

  test('all-metadata user message returns undefined (no real prompt)', () => {
    const msg = user([
      { type: 'text', text: '<ide_selection>x</ide_selection>' },
      { type: 'text', text: '<ide_opened_file>y</ide_opened_file>' },
    ])
    expect(getFirstMeaningfulUserMessageTextContent([msg])).toBeUndefined()
  })
})

describe('getFirstMeaningfulUserMessageTextContent — interrupt + skip patterns', () => {
  test('"[Request interrupted by user...]" is skipped', () => {
    const t = [
      user('[Request interrupted by user for tool use]'),
      user('real prompt'),
    ]
    expect(getFirstMeaningfulUserMessageTextContent(t)).toBe('real prompt')
  })

  test('non-letter XML-like tag does NOT match skip pattern', () => {
    // SKIP_FIRST_PROMPT_PATTERN: /^(?:\s*<[a-z][\w-]*[\s>]|...)
    // Numeric / digit-prefixed tags don't match — return as-is.
    expect(
      getFirstMeaningfulUserMessageTextContent([user('<3 example')]),
    ).toBe('<3 example')
  })

  test('uppercase XML tag does NOT match skip pattern (lowercase only)', () => {
    // The regex is lowercase-only (`[a-z]`) — uppercase tags pass through.
    // This is a documented behavior, not a bug: the codebase only emits
    // lowercase XML tags for control/metadata.
    expect(
      getFirstMeaningfulUserMessageTextContent([user('<Foo>x</Foo>')]),
    ).toBe('<Foo>x</Foo>')
  })

  test('leading whitespace before XML tag still skips', () => {
    const t = [user('   <ide_selection>x</ide_selection>'), user('next')]
    expect(getFirstMeaningfulUserMessageTextContent(t)).toBe('next')
  })
})

describe('getFirstMeaningfulUserMessageTextContent — image-only / non-text content', () => {
  test('image-only block returns undefined for that message', () => {
    const msg = user([
      { type: 'image', source: { type: 'base64', data: 'x', media_type: 'png' } },
    ])
    expect(getFirstMeaningfulUserMessageTextContent([msg])).toBeUndefined()
  })

  test('image followed by text picks up the text', () => {
    const msg = user([
      { type: 'image', source: { type: 'base64', data: 'x', media_type: 'png' } },
      { type: 'text', text: 'analyze this' },
    ])
    expect(getFirstMeaningfulUserMessageTextContent([msg])).toBe('analyze this')
  })

  test('empty text block in array is skipped', () => {
    const msg = user([
      { type: 'text', text: '' },
      { type: 'text', text: 'real prompt' },
    ])
    expect(getFirstMeaningfulUserMessageTextContent([msg])).toBe('real prompt')
  })
})

describe('removeExtraFields — strips non-serializable fields', () => {
  test('strips parentUuid', () => {
    const result = removeExtraFields([
      {
        type: 'user',
        uuid: 'u1' as UUID,
        parentUuid: 'parent-1' as UUID,
        message: { role: 'user', content: 'hi' },
      } as never,
    ])
    expect(result[0]).not.toHaveProperty('parentUuid')
    expect(result[0]).toHaveProperty('uuid', 'u1')
  })

  test('strips isSidechain', () => {
    const result = removeExtraFields([
      {
        type: 'user',
        uuid: 'u1' as UUID,
        isSidechain: true,
        message: { role: 'user', content: 'hi' },
      } as never,
    ])
    expect(result[0]).not.toHaveProperty('isSidechain')
  })

  test('preserves other fields (uuid, message, type)', () => {
    const result = removeExtraFields([
      {
        type: 'user',
        uuid: 'u1' as UUID,
        parentUuid: 'p1' as UUID,
        isSidechain: false,
        isMeta: true,
        message: { role: 'user', content: 'hi' },
      } as never,
    ])
    expect(result[0]).toMatchObject({
      type: 'user',
      uuid: 'u1',
      isMeta: true,
      message: { role: 'user', content: 'hi' },
    })
  })

  test('empty array returns empty array', () => {
    expect(removeExtraFields([])).toEqual([])
  })

  test('mapping is a fresh object (no in-place mutation)', () => {
    const original = {
      type: 'user',
      uuid: 'u1' as UUID,
      parentUuid: 'p1' as UUID,
      message: { role: 'user', content: 'hi' },
    } as never
    const [stripped] = removeExtraFields([original])
    // Original retains parentUuid; stripped doesn't.
    expect((original as { parentUuid?: string }).parentUuid).toBe('p1')
    expect(stripped).not.toHaveProperty('parentUuid')
  })
})
