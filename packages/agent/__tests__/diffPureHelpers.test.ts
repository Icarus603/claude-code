import { describe, expect, test } from 'bun:test'
import {
  adjustHunkLineNumbers,
  CONTEXT_LINES,
  DIFF_TIMEOUT_MS,
} from '../diff.js'

describe('CONTEXT_LINES + DIFF_TIMEOUT_MS — operational constants', () => {
  test('CONTEXT_LINES = 3 (standard unified-diff context)', () => {
    expect(CONTEXT_LINES).toBe(3)
  })

  test('DIFF_TIMEOUT_MS = 5000 (5 seconds, pathological-input cap)', () => {
    expect(DIFF_TIMEOUT_MS).toBe(5_000)
  })
})

describe('adjustHunkLineNumbers — slice-relative → file-relative offset', () => {
  function hunk(oldStart: number, newStart: number): {
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    lines: string[]
  } {
    return {
      oldStart,
      oldLines: 1,
      newStart,
      newLines: 1,
      lines: ['-old', '+new'],
    }
  }

  test('offset 0 → returns reference unchanged (fast-path)', () => {
    // CRITICAL: when offset is 0, the function MUST return the same array
    // reference (no allocation). This is a hot-path optimization for the
    // common case (full-file diff, not slice).
    const h = [hunk(1, 1), hunk(10, 10)]
    expect(adjustHunkLineNumbers(h, 0)).toBe(h)
  })

  test('positive offset shifts both oldStart and newStart', () => {
    const adjusted = adjustHunkLineNumbers([hunk(1, 1)], 100)
    expect(adjusted).toEqual([
      {
        oldStart: 101,
        oldLines: 1,
        newStart: 101,
        newLines: 1,
        lines: ['-old', '+new'],
      },
    ])
  })

  test('negative offset shifts down (e.g. ctx.lineOffset - 1 with offset=0)', () => {
    // The doc says callers pass `ctx.lineOffset - 1`. When lineOffset=1
    // (no slice), that's offset=0 → no shift. When lineOffset=10, the
    // shift is +9. Negative offsets should also work (rare but documented).
    const adjusted = adjustHunkLineNumbers([hunk(105, 105)], -100)
    expect(adjusted[0]).toMatchObject({ oldStart: 5, newStart: 5 })
  })

  test('multi-hunk array — each independently shifted', () => {
    const adjusted = adjustHunkLineNumbers(
      [hunk(1, 1), hunk(10, 12), hunk(20, 25)],
      50,
    )
    expect(adjusted.map(h => [h.oldStart, h.newStart])).toEqual([
      [51, 51],
      [60, 62],
      [70, 75],
    ])
  })

  test('empty array → empty array (no-op safe)', () => {
    expect(adjustHunkLineNumbers([], 100)).toEqual([])
  })

  test('preserves non-line-number fields (oldLines, newLines, lines)', () => {
    const original = {
      oldStart: 5,
      oldLines: 3,
      newStart: 5,
      newLines: 4,
      lines: [' context', '-removed', '+added1', '+added2'],
    }
    const [adjusted] = adjustHunkLineNumbers([original], 10)
    expect(adjusted!.oldLines).toBe(3)
    expect(adjusted!.newLines).toBe(4)
    expect(adjusted!.lines).toEqual(original.lines)
  })

  test('returns NEW array (not mutating input) when offset != 0', () => {
    const input = [hunk(1, 1)]
    const result = adjustHunkLineNumbers(input, 5)
    expect(result).not.toBe(input)
    expect(input[0]!.oldStart).toBe(1) // input unchanged
  })

  test('large offsets (1M+) work without overflow', () => {
    const adjusted = adjustHunkLineNumbers([hunk(1, 1)], 1_000_000)
    expect(adjusted[0]!.oldStart).toBe(1_000_001)
  })
})
