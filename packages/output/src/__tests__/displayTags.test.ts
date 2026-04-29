import { describe, expect, test } from 'bun:test'
import {
  stripDisplayTags,
  stripDisplayTagsAllowEmpty,
  stripIdeContextTags,
} from '../utils/displayTags.js'

describe('stripDisplayTags', () => {
  test('strips a single tag block', () => {
    expect(stripDisplayTags('<task-notification>foo</task-notification>')).toBe(
      // empty after strip — falls back to original
      '<task-notification>foo</task-notification>',
    )
  })

  test('strips a tag block surrounded by user prose', () => {
    expect(
      stripDisplayTags(
        'real query <ide_opened_file>some.ts</ide_opened_file> here',
      ),
    ).toBe('real query  here')
  })

  test('returns original when stripping leaves empty result', () => {
    // Pure-tag input — fallback to original (better than empty title)
    const input = '<channel-message>hello</channel-message>'
    expect(stripDisplayTags(input)).toBe(input)
  })

  test('user-prose with JSX/HTML uppercase tags passes through', () => {
    // Uppercase tag name — never matches the pattern, so body untouched
    expect(stripDisplayTags('fix the <Button>foo</Button> layout')).toBe(
      'fix the <Button>foo</Button> layout',
    )
  })

  test('user-prose with !DOCTYPE passes through', () => {
    expect(stripDisplayTags('<!DOCTYPE html>')).toBe('<!DOCTYPE html>')
  })

  test('handles multi-line tag bodies', () => {
    expect(
      stripDisplayTags(
        'before<task-notification>line1\nline2\nline3</task-notification>after',
      ),
    ).toBe('beforeafter')
  })

  test('keeps adjacent tag blocks separate (non-greedy match)', () => {
    expect(
      stripDisplayTags(
        '<a>1</a> middle <b>2</b>',
      ),
    ).toBe('middle')
  })

  test('unpaired angle brackets stay (math/logic prose)', () => {
    expect(stripDisplayTags('when x < y always')).toBe('when x < y always')
  })

  test('handles tag with attributes', () => {
    expect(
      stripDisplayTags('user <ide_opened_file path="/foo/bar.ts">body</ide_opened_file> said'),
    ).toBe('user  said')
  })
})

describe('stripDisplayTagsAllowEmpty', () => {
  test('returns empty when all content is tags', () => {
    expect(stripDisplayTagsAllowEmpty('<command-name>clear</command-name>')).toBe(
      '',
    )
  })

  test('keeps prose when mixed', () => {
    expect(
      stripDisplayTagsAllowEmpty('keep <tag>strip</tag> this'),
    ).toBe('keep  this')
  })
})

describe('stripIdeContextTags', () => {
  test('strips ide_opened_file', () => {
    expect(
      stripIdeContextTags('user typed <ide_opened_file>x</ide_opened_file>'),
    ).toBe('user typed')
  })

  test('strips ide_selection', () => {
    expect(
      stripIdeContextTags('here <ide_selection>foo</ide_selection> there'),
    ).toBe('here  there')
  })

  test('does NOT strip generic tags (only IDE-specific)', () => {
    expect(
      stripIdeContextTags('user typed <code>const x = 1</code>'),
    ).toBe('user typed <code>const x = 1</code>')
  })

  test('does NOT strip task-notification', () => {
    expect(
      stripIdeContextTags('foo <task-notification>x</task-notification> bar'),
    ).toBe('foo <task-notification>x</task-notification> bar')
  })

  test('preserves user-typed lowercase HTML elements', () => {
    // textForResubmit relies on this: typing "<button>foo</button>" must round-trip
    const input = 'edit <button>save</button> handler'
    expect(stripIdeContextTags(input)).toBe(input)
  })
})
