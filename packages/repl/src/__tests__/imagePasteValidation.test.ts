/**
 * Tests for isValidImagePaste + getImagePasteIds — pure helpers
 * filtering pasted content for valid (non-empty) images.
 *
 * Wrong filter:
 * - empty image content reaches the API → "image cannot be empty"
 *   error; user pastes 0-byte file → request fails
 * - text content treated as image → wrong block type sent
 *
 * Wrong ID list:
 * - filter and ID list out of sync (Caller relies on `getImagePasteIds`
 *   matching the filtered subset for tracking; mismatch breaks
 *   ImagePasteAttachment IDs in QueuedCommand)
 */
import { describe, expect, test } from 'bun:test'
import {
  getImagePasteIds,
  isValidImagePaste,
} from '../textInputTypes.js'

type PastedContent = Parameters<typeof isValidImagePaste>[0]

const imagePaste = (id: number, content: string): PastedContent =>
  ({ id, type: 'image', content }) as PastedContent

const textPaste = (id: number, content: string): PastedContent =>
  ({ id, type: 'text', content }) as PastedContent

describe('isValidImagePaste — type and content filter', () => {
  test('image with non-empty content → true', () => {
    expect(isValidImagePaste(imagePaste(1, 'base64-data'))).toBe(true)
  })

  test('image with empty content → false', () => {
    // Documented: API rejects empty base64 → caller MUST filter.
    expect(isValidImagePaste(imagePaste(1, ''))).toBe(false)
  })

  test('text paste → false (wrong type)', () => {
    expect(isValidImagePaste(textPaste(1, 'some text'))).toBe(false)
  })

  test('text with empty content → false', () => {
    expect(isValidImagePaste(textPaste(1, ''))).toBe(false)
  })

  test('image with single-character content → true', () => {
    // Boundary: any non-empty content is acceptable; the API/decoder
    // will reject malformed base64 separately.
    expect(isValidImagePaste(imagePaste(1, 'a'))).toBe(true)
  })
})

describe('getImagePasteIds — filtered ID extraction', () => {
  test('undefined input → undefined', () => {
    expect(getImagePasteIds(undefined)).toBeUndefined()
  })

  test('empty record → undefined (not [])', () => {
    // Documented: returns undefined when no valid images, so caller
    // can use `?.` chains and treat "no images" as a single state.
    expect(getImagePasteIds({})).toBeUndefined()
  })

  test('only text pastes → undefined', () => {
    expect(
      getImagePasteIds({
        1: textPaste(1, 'hello'),
        2: textPaste(2, 'world'),
      }),
    ).toBeUndefined()
  })

  test('only empty images → undefined (after filter)', () => {
    expect(
      getImagePasteIds({
        1: imagePaste(1, ''),
        2: imagePaste(2, ''),
      }),
    ).toBeUndefined()
  })

  test('mixed valid + invalid → only valid IDs', () => {
    expect(
      getImagePasteIds({
        1: imagePaste(1, 'data'),
        2: textPaste(2, 'text'),
        3: imagePaste(3, ''),
        4: imagePaste(4, 'more-data'),
      }),
    ).toEqual([1, 4])
  })

  test('all valid images → all IDs', () => {
    expect(
      getImagePasteIds({
        1: imagePaste(1, 'a'),
        2: imagePaste(2, 'b'),
        3: imagePaste(3, 'c'),
      }),
    ).toEqual([1, 2, 3])
  })

  test('IDs preserve insertion order (Object.values)', () => {
    // Object.values iteration order matches insertion order for
    // non-numeric string keys; numeric keys are sorted ascending.
    // Here keys 5/2/9 → numeric sort → [2, 5, 9].
    const r = getImagePasteIds({
      5: imagePaste(5, 'a'),
      2: imagePaste(2, 'b'),
      9: imagePaste(9, 'c'),
    })
    expect(r).toEqual([2, 5, 9])
  })

  test('large numeric keys sorted ascending', () => {
    const r = getImagePasteIds({
      100: imagePaste(100, 'a'),
      50: imagePaste(50, 'b'),
      75: imagePaste(75, 'c'),
    })
    expect(r).toEqual([50, 75, 100])
  })
})

describe('getImagePasteIds — return shape', () => {
  test('returns array of numbers when non-empty', () => {
    const r = getImagePasteIds({ 1: imagePaste(1, 'x') })
    expect(Array.isArray(r)).toBe(true)
    expect(r?.every(id => typeof id === 'number')).toBe(true)
  })

  test('IDs match the source content IDs verbatim', () => {
    // The filter preserves the c.id field, NOT the record key.
    // Test what happens when key !== c.id (rare but possible if
    // callers built the record from elsewhere).
    const r = getImagePasteIds({
      99: imagePaste(7, 'data'),
    })
    expect(r).toEqual([7]) // returns 7, not 99
  })
})

describe('isValidImagePaste + getImagePasteIds — sync', () => {
  test('every ID returned by getImagePasteIds passes isValidImagePaste', () => {
    const all = {
      1: imagePaste(1, 'data1'),
      2: textPaste(2, 'text'),
      3: imagePaste(3, ''),
      4: imagePaste(4, 'data4'),
    }
    const ids = getImagePasteIds(all) ?? []
    for (const id of ids) {
      const paste = Object.values(all).find(p => p.id === id)!
      expect(isValidImagePaste(paste)).toBe(true)
    }
  })
})
