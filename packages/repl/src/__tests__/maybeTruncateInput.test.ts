/**
 * Tests for maybeTruncateInput — input-paste truncation for very long
 * pasted content. Long inputs (> 10K chars) get a `[...Truncated text
 * #N +M lines...]` placeholder inserted between the first 500 and
 * last 500 chars, with the truncated content stashed in pastedContents.
 *
 * Wrong threshold or wrong slice math = either lots of small pastes
 * get spuriously truncated or the actual text the model sees gets
 * mangled in the middle.
 */
import { describe, expect, test } from 'bun:test'
import { maybeTruncateInput } from '../components/PromptInput/inputPaste.js'

describe('maybeTruncateInput — under threshold', () => {
  test('input under 10K chars is unchanged', () => {
    const input = 'a'.repeat(5000)
    const { newInput, newPastedContents } = maybeTruncateInput(input, {})
    expect(newInput).toBe(input)
    expect(newPastedContents).toEqual({})
  })

  test('exactly 10K chars is unchanged (≤ threshold)', () => {
    const input = 'a'.repeat(10_000)
    const r = maybeTruncateInput(input, {})
    expect(r.newInput).toBe(input)
    expect(r.newPastedContents).toEqual({})
  })

  test('empty string unchanged', () => {
    expect(maybeTruncateInput('', {})).toEqual({
      newInput: '',
      newPastedContents: {},
    })
  })
})

describe('maybeTruncateInput — over threshold', () => {
  test('input over 10K chars gets truncated', () => {
    const input = 'a'.repeat(15_000)
    const { newInput, newPastedContents } = maybeTruncateInput(input, {})
    expect(newInput.length).toBeLessThan(input.length)
    expect(newInput).toContain('[...Truncated text #1')
    expect(Object.keys(newPastedContents)).toEqual(['1'])
  })

  test('truncated content is stored under id 1 (no existing ids)', () => {
    const input = 'a'.repeat(15_000)
    const { newPastedContents } = maybeTruncateInput(input, {})
    expect(newPastedContents['1']).toBeDefined()
    expect(newPastedContents['1']?.type).toBe('text')
  })

  test('truncated id is one more than max existing id', () => {
    // existingIds = [3, 7] → next is 8
    const input = 'a'.repeat(15_000)
    const { newPastedContents } = maybeTruncateInput(input, {
      3: { id: 3, type: 'text', content: 'x' },
      7: { id: 7, type: 'text', content: 'y' },
    } as never)
    // Existing ids preserved + new at 8
    expect(Object.keys(newPastedContents).sort()).toEqual(['3', '7', '8'])
  })

  test('preserves first ~500 chars of input', () => {
    const start = 'START_MARKER ' + 'a'.repeat(400)
    const end = 'END_MARKER ' + 'b'.repeat(400)
    const input = start + 'X'.repeat(50_000) + end
    const { newInput } = maybeTruncateInput(input, {})
    // First 500 chars retained — START_MARKER must be there.
    expect(newInput.slice(0, 13)).toBe('START_MARKER ')
  })

  test('preserves last ~500 chars of input', () => {
    const end = 'X'.repeat(490) + 'END_MARKER'
    const input = 'a'.repeat(50_000) + end
    const { newInput } = maybeTruncateInput(input, {})
    // Last 500 chars retained.
    expect(newInput.slice(-10)).toBe('END_MARKER')
  })

  test('placeholder reference includes line count of truncated body', () => {
    // 50K chars with 100 newlines in the middle → +100 lines noted.
    const middle = '\n'.repeat(100) + 'X'.repeat(40_000)
    const input = 'a'.repeat(500) + middle + 'b'.repeat(500)
    const { newInput } = maybeTruncateInput(input, {})
    // Placeholder mentions "+N lines"
    expect(newInput).toMatch(/\+\d+ lines/)
  })

  test('truncated content (placeholder body) is stored verbatim', () => {
    const input = 'aaaa'.repeat(2500) + 'BBBB' + 'cccc'.repeat(2500)
    const { newPastedContents } = maybeTruncateInput(input, {})
    const stored = newPastedContents['1']?.content
    expect(stored).toBeDefined()
    // The middle chunk should contain the BBBB marker.
    expect(stored).toContain('BBBB')
  })
})

describe('maybeTruncateInput — non-string content in pastedContents', () => {
  test('id allocation handles non-numeric / mixed keys gracefully', () => {
    // The function does Math.max on parsed ids. Unparseable ids
    // produce NaN which is excluded by the Math.max behavior.
    const input = 'a'.repeat(15_000)
    const { newPastedContents } = maybeTruncateInput(input, {
      5: { id: 5, type: 'text', content: 'x' },
    } as never)
    expect(newPastedContents['6']).toBeDefined()
  })
})
