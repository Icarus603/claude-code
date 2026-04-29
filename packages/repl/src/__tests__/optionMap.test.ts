/**
 * Tests for OptionMap — doubly-linked Map used by CustomSelect for
 * keyboard navigation. Stores options indexed by their value, with
 * each entry knowing its previous + next neighbour.
 *
 * Wrong wiring = arrow-key navigation skips entries or jumps to
 * undefined. The `first` and `last` references are the entry points
 * for first-render and wraparound.
 */
import { describe, expect, test } from 'bun:test'
import OptionMap from '../components/CustomSelect/option-map.js'

describe('OptionMap — empty', () => {
  test('empty options → empty map, first/last undefined', () => {
    const map = new OptionMap([])
    expect(map.size).toBe(0)
    expect(map.first).toBeUndefined()
    expect(map.last).toBeUndefined()
  })
})

describe('OptionMap — single option', () => {
  test('one option → first === last, no neighbours', () => {
    const map = new OptionMap([{ label: 'A', value: 'a' }])
    expect(map.size).toBe(1)
    expect(map.first).toBeDefined()
    expect(map.last).toBe(map.first)
    expect(map.first?.previous).toBeUndefined()
    expect(map.first?.next).toBeUndefined()
    expect(map.first?.index).toBe(0)
  })
})

describe('OptionMap — multi-option linked list', () => {
  test('three options form a doubly-linked chain', () => {
    const map = new OptionMap([
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
      { label: 'C', value: 'c' },
    ])
    expect(map.size).toBe(3)

    const a = map.get('a')!
    const b = map.get('b')!
    const c = map.get('c')!

    // first/last
    expect(map.first).toBe(a)
    expect(map.last).toBe(c)

    // a → b → c
    expect(a.previous).toBeUndefined()
    expect(a.next).toBe(b)
    expect(b.previous).toBe(a)
    expect(b.next).toBe(c)
    expect(c.previous).toBe(b)
    expect(c.next).toBeUndefined()

    // indexes
    expect(a.index).toBe(0)
    expect(b.index).toBe(1)
    expect(c.index).toBe(2)
  })

  test('description field flows through', () => {
    const map = new OptionMap([
      { label: 'A', value: 'a', description: 'first' },
      { label: 'B', value: 'b' },
    ])
    expect(map.get('a')?.description).toBe('first')
    expect(map.get('b')?.description).toBeUndefined()
  })

  test('label can be ReactNode (any value)', () => {
    // Documented type: ReactNode includes strings, numbers, JSX, etc.
    // The map just stores it without inspection.
    const map = new OptionMap([
      { label: 42 as never, value: 'a' },
      { label: null as never, value: 'b' },
    ])
    expect(map.get('a')?.label).toBe(42 as never)
    expect(map.get('b')?.label).toBeNull()
  })

  test('value can be any type (T generic)', () => {
    // Number values work as Map keys.
    const map = new OptionMap([
      { label: 'A', value: 1 },
      { label: 'B', value: 2 },
    ])
    expect(map.get(1)?.label).toBe('A')
    expect(map.get(2)?.label).toBe('B')
  })

  test('object values use reference equality (Map default)', () => {
    const v1 = { kind: 'a' }
    const v2 = { kind: 'b' }
    const map = new OptionMap([
      { label: 'A', value: v1 },
      { label: 'B', value: v2 },
    ])
    expect(map.get(v1)?.label).toBe('A')
    // Different reference, even with identical shape → undefined
    expect(map.get({ kind: 'a' })).toBeUndefined()
  })
})

describe('OptionMap — iteration order', () => {
  test('Map insertion order preserved', () => {
    const map = new OptionMap([
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
      { label: 'C', value: 'c' },
    ])
    const keys = Array.from(map.keys())
    expect(keys).toEqual(['a', 'b', 'c'])
  })

  test('walking via .next from first visits all in order', () => {
    const map = new OptionMap([
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
      { label: 'C', value: 'c' },
    ])
    const visited: string[] = []
    let cur = map.first
    while (cur) {
      visited.push(cur.value as string)
      cur = cur.next
    }
    expect(visited).toEqual(['a', 'b', 'c'])
  })

  test('walking via .previous from last visits all in reverse', () => {
    const map = new OptionMap([
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
      { label: 'C', value: 'c' },
    ])
    const visited: string[] = []
    let cur = map.last
    while (cur) {
      visited.push(cur.value as string)
      cur = cur.previous
    }
    expect(visited).toEqual(['c', 'b', 'a'])
  })
})

describe('OptionMap — duplicate values', () => {
  test('duplicate values: LAST entry wins (Map override)', () => {
    // Documented Map semantics: setting same key twice keeps the last.
    // For OptionMap, this means the user's data integrity depends on
    // unique values upstream. Lock the behavior so a refactor that
    // adds a "duplicate detection throw" is intentional.
    const map = new OptionMap([
      { label: 'first-A', value: 'a' },
      { label: 'second-A', value: 'a' },
    ])
    expect(map.size).toBe(1)
    expect(map.get('a')?.label).toBe('second-A')
  })
})
