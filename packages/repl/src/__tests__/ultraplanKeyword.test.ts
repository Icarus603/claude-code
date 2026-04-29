/**
 * Tests for ultraplan keyword detection — drives the rainbow-highlight
 * + "will launch ultraplan" notification in PromptInput when a user
 * types "ultraplan" outside a slash-command, code block, or path
 * context.
 *
 * Wrong detection = either:
 *   - Spurious trigger: rainbow-highlights a word in `<code>ultraplan</code>`
 *     or `src/ultraplan/foo.ts`, training users to ignore it
 *   - Missed trigger: user types "let's ultraplan this" and nothing
 *     happens; they hit submit and get a plain prompt
 *
 * The contextual rules are subtle and hand-tuned. Tests lock each
 * exclusion class so a "simplify" refactor can't quietly drop them.
 */
import { describe, expect, test } from 'bun:test'
import {
  findUltraplanTriggerPositions,
  findUltrareviewTriggerPositions,
  hasUltraplanKeyword,
  replaceUltraplanKeyword,
} from '../ultraplan/keyword.js'

describe('findUltraplanTriggerPositions — basic triggers', () => {
  test('plain word at start triggers', () => {
    const r = findUltraplanTriggerPositions('ultraplan this feature')
    expect(r).toHaveLength(1)
    expect(r[0]?.word).toBe('ultraplan')
    expect(r[0]?.start).toBe(0)
  })

  test('word in middle of sentence triggers', () => {
    const r = findUltraplanTriggerPositions("let's ultraplan it now")
    expect(r).toHaveLength(1)
  })

  test('case-insensitive', () => {
    expect(findUltraplanTriggerPositions('Ultraplan this')).toHaveLength(1)
    expect(findUltraplanTriggerPositions('ULTRAPLAN this')).toHaveLength(1)
  })

  test('multiple occurrences each tracked', () => {
    const r = findUltraplanTriggerPositions('ultraplan and then ultraplan again')
    expect(r).toHaveLength(2)
  })

  test('end-of-string with sentence punctuation triggers', () => {
    expect(findUltraplanTriggerPositions("let's ultraplan.")).toHaveLength(1)
    expect(findUltraplanTriggerPositions("let's ultraplan!")).toHaveLength(1)
    expect(findUltraplanTriggerPositions("let's ultraplan,")).toHaveLength(1)
  })
})

describe('findUltraplanTriggerPositions — slash command exclusion', () => {
  test('text starting with / NEVER triggers (slash command)', () => {
    expect(findUltraplanTriggerPositions('/rename ultraplan foo')).toEqual([])
    expect(findUltraplanTriggerPositions('/help ultraplan')).toEqual([])
  })

  test('"/" elsewhere in text is fine', () => {
    expect(findUltraplanTriggerPositions('please ultraplan a/b')).toHaveLength(1)
  })
})

describe('findUltraplanTriggerPositions — quoted/bracketed exclusion', () => {
  test('inside backticks NOT triggered', () => {
    expect(findUltraplanTriggerPositions('use `ultraplan` here')).toEqual([])
  })

  test('inside double quotes NOT triggered', () => {
    expect(findUltraplanTriggerPositions('"ultraplan" is the name')).toEqual([])
  })

  test('inside curly braces NOT triggered', () => {
    expect(findUltraplanTriggerPositions('config { ultraplan: true }')).toEqual([])
  })

  test('inside square brackets NOT triggered (innermost)', () => {
    expect(findUltraplanTriggerPositions('[ultraplan]')).toEqual([])
  })

  test('inside parens NOT triggered', () => {
    expect(findUltraplanTriggerPositions('(ultraplan)')).toEqual([])
  })

  test('inside angle brackets (tag-like) NOT triggered', () => {
    expect(findUltraplanTriggerPositions('<ultraplan>')).toEqual([])
    expect(findUltraplanTriggerPositions('</ultraplan>')).toEqual([])
  })

  test('"<" with non-tag-char following: still triggers ultraplan elsewhere', () => {
    // Documented: `<` only opens a delimiter if next char is letter or /,
    // so `n < 5 ultraplan n > 10` does NOT treat `<` as opening a tag.
    const r = findUltraplanTriggerPositions('n < 5 ultraplan n > 10')
    expect(r.length).toBeGreaterThan(0)
  })

  test("apostrophes don't break detection: \"let's\" + ultraplan triggers", () => {
    expect(findUltraplanTriggerPositions("let's ultraplan it")).toHaveLength(1)
  })

  test('single quotes as delimiters work when not apostrophes', () => {
    // 'word' opens at non-word boundary; ultraplan inside should be skipped.
    expect(findUltraplanTriggerPositions('say \'ultraplan\' loud')).toEqual([])
  })
})

describe('findUltraplanTriggerPositions — path-like / identifier exclusion', () => {
  test('preceded by / NOT triggered (path)', () => {
    expect(findUltraplanTriggerPositions('src/ultraplan/foo.ts')).toEqual([])
  })

  test('followed by / NOT triggered (path)', () => {
    expect(findUltraplanTriggerPositions('ultraplan/feature')).toEqual([])
  })

  test('preceded by - NOT triggered (kebab id)', () => {
    expect(findUltraplanTriggerPositions('--no-ultraplan')).toEqual([])
  })

  test('followed by - NOT triggered (kebab id)', () => {
    expect(findUltraplanTriggerPositions('--ultraplan-mode')).toEqual([])
  })

  test('followed by . + word NOT triggered (extension)', () => {
    expect(findUltraplanTriggerPositions('ultraplan.tsx')).toEqual([])
    expect(findUltraplanTriggerPositions('ultraplan.ts')).toEqual([])
  })

  test('followed by . at end of sentence DOES trigger', () => {
    // Documented: . + word is extension; . + non-word is sentence punct.
    expect(findUltraplanTriggerPositions('Try ultraplan.')).toHaveLength(1)
  })

  test('preceded by \\ NOT triggered (Windows path)', () => {
    expect(findUltraplanTriggerPositions('C:\\ultraplan\\foo')).toEqual([])
  })
})

describe('findUltraplanTriggerPositions — question form exclusion', () => {
  test('followed by ? NOT triggered (asking about feature)', () => {
    expect(findUltraplanTriggerPositions('What is ultraplan?')).toEqual([])
  })

  test('? must be IMMEDIATELY after the word: "is ultraplan good?" DOES trigger', () => {
    // Documented contract: only the directly-following char is checked.
    // "ultraplan good?" — the ? is on "good", not "ultraplan", so the
    // word still triggers. Locks the strict-positional check.
    expect(findUltraplanTriggerPositions('is ultraplan good?')).toHaveLength(1)
  })
})

describe('hasUltraplanKeyword — boolean wrapper', () => {
  test('triggering text → true', () => {
    expect(hasUltraplanKeyword('ultraplan now')).toBe(true)
  })

  test('non-triggering text → false', () => {
    expect(hasUltraplanKeyword('What is ultraplan?')).toBe(false)
    expect(hasUltraplanKeyword('`ultraplan`')).toBe(false)
    expect(hasUltraplanKeyword('plan ahead')).toBe(false)
    expect(hasUltraplanKeyword('')).toBe(false)
  })
})

describe('findUltrareviewTriggerPositions — sibling keyword', () => {
  test('detects "ultrareview" with same rules', () => {
    expect(findUltrareviewTriggerPositions('please ultrareview this')).toHaveLength(1)
  })

  test('inside backticks NOT triggered', () => {
    expect(findUltrareviewTriggerPositions('`ultrareview`')).toEqual([])
  })

  test('does NOT match ultraplan', () => {
    expect(findUltrareviewTriggerPositions('please ultraplan this')).toEqual([])
  })

  test('does NOT match partial words', () => {
    expect(findUltrareviewTriggerPositions('ultrareviewing')).toEqual([])
  })
})

describe('replaceUltraplanKeyword — strip "ultra" prefix from first match', () => {
  test('replaces first "ultraplan" with "plan", preserves casing', () => {
    expect(replaceUltraplanKeyword('please ultraplan this')).toBe('please plan this')
    expect(replaceUltraplanKeyword('please Ultraplan this')).toBe('please plan this')
    expect(replaceUltraplanKeyword('ULTRAPLAN this')).toBe('PLAN this')
  })

  test('only first match replaced (subsequent ones kept)', () => {
    // The function uses findUltraplanTriggerPositions — but only [0] is
    // operated on. Subsequent occurrences stay as "ultraplan".
    const r = replaceUltraplanKeyword('ultraplan and then ultraplan')
    expect(r).toContain('plan')
    // Second occurrence preserved
    expect(r.split(/plan/i).length).toBe(3) // 'plan' appears twice via 'ultraplan' + 'plan'
  })

  test('non-trigger text unchanged', () => {
    expect(replaceUltraplanKeyword('What is ultraplan?')).toBe('What is ultraplan?')
    expect(replaceUltraplanKeyword('`ultraplan`')).toBe('`ultraplan`')
    expect(replaceUltraplanKeyword('plan ahead')).toBe('plan ahead')
  })

  test('empty string → empty', () => {
    expect(replaceUltraplanKeyword('')).toBe('')
  })

  test('trigger word alone with surrounding whitespace → empty', () => {
    // Documented: replacing "ultraplan" → "plan", but if the rest is
    // whitespace-only, return empty (no point in just "plan").
    // Actually: returns '' only if the BEFORE+AFTER is empty (trim).
    expect(replaceUltraplanKeyword('ultraplan')).toBe('')
    expect(replaceUltraplanKeyword('  ultraplan  ')).toBe('')
  })
})
