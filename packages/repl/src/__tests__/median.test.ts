import { describe, expect, test } from 'bun:test'
import { median } from '../screens/repl/median.js'

describe('median', () => {
  test('odd-length array returns middle element', () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3)
  })

  test('even-length array returns rounded average of middle two', () => {
    expect(median([1, 2, 3, 4])).toBe(3) // (2+3)/2 = 2.5 → round to 3
  })

  test('even-length where average rounds DOWN (banker\'s rounding does NOT apply)', () => {
    // Math.round uses half-away-from-zero for positive — (3+4)/2 = 3.5 → 4
    expect(median([3, 4])).toBe(4)
  })

  test('even-length where average is exact integer', () => {
    expect(median([2, 6])).toBe(4) // (2+6)/2 = 4
  })

  test('single-element array', () => {
    expect(median([42])).toBe(42)
  })

  test('two-element array', () => {
    expect(median([10, 20])).toBe(15)
  })

  test('does NOT mutate input array', () => {
    const input = [5, 3, 1, 4, 2]
    median(input)
    expect(input).toEqual([5, 3, 1, 4, 2])
  })

  test('handles unsorted input', () => {
    expect(median([5, 3, 1, 4, 2])).toBe(3)
  })

  test('handles all-equal values', () => {
    expect(median([7, 7, 7, 7])).toBe(7)
  })

  test('handles negative numbers', () => {
    expect(median([-5, -3, -1])).toBe(-3)
  })

  test('handles mix of positive + negative', () => {
    expect(median([-2, 0, 2])).toBe(0)
  })

  test('handles large arrays (100 numbers)', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1) // 1..100
    // Median of 1..100 = (50+51)/2 = 50.5 → round to 51
    expect(median(values)).toBe(51)
  })

  test('handles duplicate values', () => {
    expect(median([1, 2, 2, 2, 3])).toBe(2)
  })

  test('handles floats — result is rounded integer (not float)', () => {
    // (1.5 + 2.5) / 2 = 2.0 → 2
    expect(median([1.5, 2.5])).toBe(2)
  })

  test('handles floats with non-integer median', () => {
    // (1.4 + 2.4) / 2 = 1.9 → round to 2
    expect(median([1.4, 2.4])).toBe(2)
  })
})
