import { describe, expect, test } from 'bun:test'
import { cloneFileStateCache } from '../internal/fileStateCache.js'

// Stub FileStateCache class — implements the duck-type contract:
// `max`, `maxSize`, `dump()`, `load()`, plus a 2-arg constructor.
class StubCache {
  readonly max: number
  readonly maxSize: number
  private state: Map<string, string>

  constructor(max: number, maxSize: number) {
    this.max = max
    this.maxSize = maxSize
    this.state = new Map()
  }

  set(key: string, value: string): void {
    this.state.set(key, value)
  }

  get(key: string): string | undefined {
    return this.state.get(key)
  }

  dump(): unknown {
    return Array.from(this.state.entries())
  }

  load(entries: unknown): void {
    this.state = new Map(entries as [string, string][])
  }
}

describe('cloneFileStateCache', () => {
  test('returns a new instance (not the same reference)', () => {
    const original = new StubCache(10, 1024)
    const cloned = cloneFileStateCache(original)
    expect(cloned).not.toBe(original)
  })

  test('returns an instance of the same constructor', () => {
    const original = new StubCache(10, 1024)
    const cloned = cloneFileStateCache(original)
    expect(cloned).toBeInstanceOf(StubCache)
  })

  test('preserves max and maxSize from the original', () => {
    const original = new StubCache(50, 4096)
    const cloned = cloneFileStateCache(original)
    expect(cloned.max).toBe(50)
    expect(cloned.maxSize).toBe(4096)
  })

  test('clone receives the dumped entries', () => {
    const original = new StubCache(10, 1024)
    original.set('foo', 'bar')
    original.set('baz', 'qux')
    const cloned = cloneFileStateCache(original) as StubCache
    expect(cloned.get('foo')).toBe('bar')
    expect(cloned.get('baz')).toBe('qux')
  })

  test('clone is independent — mutating the clone does not affect the original', () => {
    const original = new StubCache(10, 1024)
    original.set('a', '1')
    const cloned = cloneFileStateCache(original) as StubCache
    cloned.set('b', '2')
    expect(original.get('b')).toBeUndefined()
    expect(cloned.get('b')).toBe('2')
  })

  test('clone is independent — mutating the original after clone does not affect the clone', () => {
    const original = new StubCache(10, 1024)
    original.set('a', 'first')
    const cloned = cloneFileStateCache(original) as StubCache
    original.set('a', 'changed')
    expect(cloned.get('a')).toBe('first')
  })

  test('handles empty original cache', () => {
    const original = new StubCache(10, 1024)
    const cloned = cloneFileStateCache(original) as StubCache
    expect(cloned.get('anything')).toBeUndefined()
    expect(cloned.max).toBe(10)
    expect(cloned.maxSize).toBe(1024)
  })

  test('clones via the original instance constructor (preserves subclass identity)', () => {
    // Subclass test — the function uses `cache.constructor as new (...) => ...`
    // so subclasses get cloned to the SAME subclass type, not the parent.
    class SubCache extends StubCache {
      readonly subclassMarker = 'sub'
    }
    const original = new SubCache(10, 512)
    const cloned = cloneFileStateCache(original)
    expect(cloned).toBeInstanceOf(SubCache)
    expect((cloned as SubCache).subclassMarker).toBe('sub')
  })
})
