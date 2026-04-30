/**
 * Tests for isEmptyMessageText + stripPromptXMLTags — pure helpers
 * for detecting "empty" message content and stripping internal XML
 * wrapper tags before display/comparison.
 *
 * stripPromptXMLTags removes 4 specific tag families from prompts:
 *   <commit_analysis>, <context>, <function_analysis>, <pr_analysis>
 * These are PROMPT-INJECTION wrappers (system commands), not display
 * tags (which use stripDisplayTags in @claude-code/output).
 *
 * isEmptyMessageText is true when:
 *   - text is whitespace-only after stripping the wrapper tags, OR
 *   - text equals the canonical NO_CONTENT_MESSAGE sentinel
 *
 * Wrong = empty messages slip into transcript (tokens wasted on
 * "(no content)" placeholders) or genuine non-empty messages get
 * filtered out (user thinks model didn't reply).
 */
import { describe, expect, test } from 'bun:test'
import { isEmptyMessageText, stripPromptXMLTags } from '../messages.js'
import { NO_CONTENT_MESSAGE } from '../constants/messages.js'

describe('stripPromptXMLTags — strips 4 specific tag families', () => {
  test('<commit_analysis>...</commit_analysis> stripped', () => {
    expect(
      stripPromptXMLTags('<commit_analysis>git stuff</commit_analysis>'),
    ).toBe('')
  })

  test('<context>...</context> stripped', () => {
    expect(stripPromptXMLTags('<context>file info</context>')).toBe('')
  })

  test('<function_analysis>...</function_analysis> stripped', () => {
    expect(
      stripPromptXMLTags('<function_analysis>code</function_analysis>'),
    ).toBe('')
  })

  test('<pr_analysis>...</pr_analysis> stripped', () => {
    expect(stripPromptXMLTags('<pr_analysis>PR review</pr_analysis>')).toBe('')
  })

  test('multiple tag families in one input all stripped', () => {
    expect(
      stripPromptXMLTags(
        '<context>x</context><commit_analysis>y</commit_analysis>',
      ),
    ).toBe('')
  })

  test('content outside wrapper preserved', () => {
    expect(
      stripPromptXMLTags(
        'real text<context>system context</context>more text',
      ),
    ).toBe('real textmore text')
  })

  test('only whitespace outside wrapper trims', () => {
    expect(
      stripPromptXMLTags('   <context>x</context>   '),
    ).toBe('')
  })

  test('multiline content inside wrapper stripped', () => {
    expect(
      stripPromptXMLTags(
        '<context>\nline1\nline2\n</context>',
      ),
    ).toBe('')
  })

  test('non-stripped tag (e.g. <thinking>) preserved', () => {
    expect(
      stripPromptXMLTags('<thinking>kept</thinking>'),
    ).toBe('<thinking>kept</thinking>')
  })

  test('plain text passes through', () => {
    expect(stripPromptXMLTags('hello world')).toBe('hello world')
  })

  test('empty string → empty string', () => {
    expect(stripPromptXMLTags('')).toBe('')
  })

  test('whitespace-only → empty string (trim)', () => {
    expect(stripPromptXMLTags('   \n\t  ')).toBe('')
  })
})

describe('isEmptyMessageText — true cases', () => {
  test('empty string → true', () => {
    expect(isEmptyMessageText('')).toBe(true)
  })

  test('whitespace-only → true', () => {
    expect(isEmptyMessageText('   \n\t  ')).toBe(true)
  })

  test('only stripped XML tags → true', () => {
    expect(
      isEmptyMessageText('<context>system info</context>'),
    ).toBe(true)
  })

  test('multiple stripped tags only → true', () => {
    expect(
      isEmptyMessageText(
        '<context>x</context>\n<commit_analysis>y</commit_analysis>',
      ),
    ).toBe(true)
  })

  test('NO_CONTENT_MESSAGE sentinel → true', () => {
    expect(isEmptyMessageText(NO_CONTENT_MESSAGE)).toBe(true)
  })

  test('NO_CONTENT_MESSAGE with surrounding whitespace → true', () => {
    expect(isEmptyMessageText(`   ${NO_CONTENT_MESSAGE}   `)).toBe(true)
  })
})

describe('isEmptyMessageText — false cases', () => {
  test('plain text → false', () => {
    expect(isEmptyMessageText('hello')).toBe(false)
  })

  test('text with stripped tags + real content → false', () => {
    expect(
      isEmptyMessageText('<context>x</context>real content'),
    ).toBe(false)
  })

  test('non-stripped tag (e.g. <thinking>) → false', () => {
    expect(
      isEmptyMessageText('<thinking>preserved content</thinking>'),
    ).toBe(false)
  })

  test('NO_CONTENT_MESSAGE substring (not exact match after trim) → false', () => {
    // Locked: only EXACT match (after trim) of NO_CONTENT_MESSAGE
    // counts. Adjacent text disqualifies.
    expect(
      isEmptyMessageText(`prefix ${NO_CONTENT_MESSAGE}`),
    ).toBe(false)
  })

  test('case-sensitive sentinel match', () => {
    expect(isEmptyMessageText('(NO CONTENT)')).toBe(false)
  })

  test('single-character text → false', () => {
    expect(isEmptyMessageText('x')).toBe(false)
  })
})

describe('return shape', () => {
  test('isEmptyMessageText always returns boolean', () => {
    const samples = ['', 'hello', NO_CONTENT_MESSAGE, '<context>x</context>']
    for (const s of samples) {
      expect(typeof isEmptyMessageText(s)).toBe('boolean')
    }
  })

  test('stripPromptXMLTags always returns string', () => {
    const samples = ['', 'hello', '<context>x</context>', 'before<context>y</context>after']
    for (const s of samples) {
      expect(typeof stripPromptXMLTags(s)).toBe('string')
    }
  })
})
