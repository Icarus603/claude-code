/**
 * Tests for getLogDisplayTitle — pure helper that picks the best
 * display title for a session in /resume picker. The fallback
 * chain has 6 levels:
 *   1. agentName (set via /rename or by swarm spawn)
 *   2. customTitle (user-set)
 *   3. summary (auto-derived)
 *   4. firstPrompt (if non-empty after stripping XML tags
 *      AND not an autonomous <tick> prompt)
 *   5. defaultTitle (caller-provided)
 *   6. "Autonomous session" (when firstPrompt was a <tick>)
 *   7. sessionId.slice(0, 8) as last resort
 *   8. ''
 *
 * Wrong priority = wrong session shown to the user when multiple
 * have the same prefix. The autonomous-prompt skip is critical:
 * the auto-prompt is `<tick>do this</tick>` — without skipping, the
 * picker would show the raw XML which is meaningless to the user.
 */
import { describe, expect, test } from 'bun:test'
import { getLogDisplayTitle } from '../log.js'

type LogOption = Parameters<typeof getLogDisplayTitle>[0]

const baseLog = (overrides: Partial<LogOption> = {}): LogOption =>
  ({
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    firstPrompt: '',
    ...overrides,
  }) as LogOption

describe('getLogDisplayTitle — fallback priority', () => {
  test('agentName takes top priority', () => {
    expect(
      getLogDisplayTitle(
        baseLog({
          agentName: 'researcher',
          customTitle: 'custom',
          summary: 'sum',
          firstPrompt: 'first',
        }),
        'def',
      ),
    ).toBe('researcher')
  })

  test('customTitle is preferred over summary + firstPrompt', () => {
    expect(
      getLogDisplayTitle(
        baseLog({
          customTitle: 'my custom',
          summary: 'sum',
          firstPrompt: 'first',
        }),
      ),
    ).toBe('my custom')
  })

  test('summary used when no agentName/customTitle', () => {
    expect(
      getLogDisplayTitle(
        baseLog({ summary: 'a session summary', firstPrompt: 'first' }),
      ),
    ).toBe('a session summary')
  })

  test('firstPrompt used when no agentName/customTitle/summary', () => {
    expect(
      getLogDisplayTitle(baseLog({ firstPrompt: 'help me debug' })),
    ).toBe('help me debug')
  })

  test('defaultTitle used when nothing else available', () => {
    expect(
      getLogDisplayTitle(baseLog({ firstPrompt: '' }), 'fallback default'),
    ).toBe('fallback default')
  })

  test('sessionId 8-char prefix used last', () => {
    expect(
      getLogDisplayTitle(
        baseLog({
          sessionId: '550e8400-e29b-41d4-a716-446655440000',
          firstPrompt: '',
        }),
      ),
    ).toBe('550e8400')
  })

  test('empty string when no fields available', () => {
    expect(
      getLogDisplayTitle(baseLog({ sessionId: '', firstPrompt: '' })),
    ).toBe('')
  })
})

describe('getLogDisplayTitle — autonomous prompt handling', () => {
  test('<tick> prompt skipped → "Autonomous session" used', () => {
    // Documented contract: when firstPrompt starts with <tick>, the
    // picker must NOT show the raw XML — fall through to the
    // synthetic "Autonomous session" label.
    expect(
      getLogDisplayTitle(
        baseLog({ firstPrompt: '<tick>do this thing</tick>' }),
      ),
    ).toBe('Autonomous session')
  })

  test('<tick> with no other fields → "Autonomous session"', () => {
    expect(
      getLogDisplayTitle(baseLog({ firstPrompt: '<tick>auto</tick>' })),
    ).toBe('Autonomous session')
  })

  test('<tick> + customTitle → customTitle wins (not autonomous)', () => {
    expect(
      getLogDisplayTitle(
        baseLog({
          firstPrompt: '<tick>auto</tick>',
          customTitle: 'My Title',
        }),
      ),
    ).toBe('My Title')
  })

  test('<tick> + defaultTitle → defaultTitle wins over autonomous label', () => {
    // defaultTitle comes BEFORE the autonomous label in the chain.
    expect(
      getLogDisplayTitle(
        baseLog({ firstPrompt: '<tick>auto</tick>' }),
        'def',
      ),
    ).toBe('def')
  })
})

describe('getLogDisplayTitle — XML tag stripping in firstPrompt', () => {
  test('firstPrompt with embedded ide_opened_file tag → tag stripped', () => {
    expect(
      getLogDisplayTitle(
        baseLog({
          firstPrompt:
            '<ide_opened_file>foo.ts</ide_opened_file>real prompt text',
        }),
      ),
    ).toBe('real prompt text')
  })

  test('firstPrompt that is ONLY an XML tag → empty after strip → next fallback', () => {
    // After stripping, firstPrompt is empty. Should fall through.
    expect(
      getLogDisplayTitle(
        baseLog({
          firstPrompt: '<ide_opened_file>foo.ts</ide_opened_file>',
          sessionId: 'abcd1234-deadbeef',
        }),
      ),
    ).toBe('abcd1234')
  })

  test('firstPrompt with mixed tags + text → text portion remains', () => {
    expect(
      getLogDisplayTitle(
        baseLog({
          firstPrompt:
            '<hook>system note</hook>actual user query<ide_selection>x</ide_selection>',
        }),
      ),
    ).toBe('actual user query')
  })

  test('user prose with uppercase XML-like content (e.g. <Button>) preserved', () => {
    // The strip only matches lowercase tag names — user prose with
    // <Button> or <!DOCTYPE> doesn't get stripped.
    expect(
      getLogDisplayTitle(
        baseLog({ firstPrompt: 'fix the <Button> layout' }),
      ),
    ).toBe('fix the <Button> layout')
  })
})

describe('getLogDisplayTitle — title trimming', () => {
  test('whitespace stripped from final result', () => {
    expect(
      getLogDisplayTitle(baseLog({ summary: '   summary   ' })),
    ).toBe('summary')
  })

  test('agentName trimmed too', () => {
    expect(
      getLogDisplayTitle(baseLog({ agentName: '  bot  ' })),
    ).toBe('bot')
  })
})

describe('getLogDisplayTitle — empty-string priority quirks', () => {
  test('empty agentName falls through to customTitle', () => {
    expect(
      getLogDisplayTitle(
        baseLog({ agentName: '', customTitle: 'custom' }),
      ),
    ).toBe('custom')
  })

  test('empty customTitle falls through to summary', () => {
    expect(
      getLogDisplayTitle(
        baseLog({ customTitle: '', summary: 'sum' }),
      ),
    ).toBe('sum')
  })

  test('empty summary falls through to firstPrompt', () => {
    expect(
      getLogDisplayTitle(
        baseLog({ summary: '', firstPrompt: 'first' }),
      ),
    ).toBe('first')
  })
})

describe('getLogDisplayTitle — sessionId edge cases', () => {
  test('short sessionId (< 8 chars) used as-is', () => {
    expect(
      getLogDisplayTitle(baseLog({ sessionId: 'abc', firstPrompt: '' })),
    ).toBe('abc')
  })

  test('exactly 8 char sessionId', () => {
    expect(
      getLogDisplayTitle(
        baseLog({ sessionId: 'abcdefgh', firstPrompt: '' }),
      ),
    ).toBe('abcdefgh')
  })
})
