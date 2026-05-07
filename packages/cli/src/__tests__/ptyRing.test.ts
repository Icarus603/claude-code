import { describe, expect, test } from 'bun:test'
import { createRing } from '../bg/ptyRing.js'

describe('createRing', () => {
  test('stores chunks under cap intact', () => {
    const r = createRing(100)
    r.push(Buffer.from('hello'))
    r.push(Buffer.from(' world'))
    expect(r.chunks.map(c => c.toString())).toEqual(['hello', ' world'])
  })

  test('evicts oldest chunks when total exceeds cap', () => {
    const r = createRing(10)
    r.push(Buffer.from('aaaaa'))
    r.push(Buffer.from('bbbbb'))
    r.push(Buffer.from('ccccc'))
    // Cap=10; after pushing 15 bytes, oldest 'aaaaa' is dropped.
    const total = r.chunks.reduce((n, c) => n + c.length, 0)
    expect(total).toBeLessThanOrEqual(10)
    expect(r.chunks.map(c => c.toString()).join('')).not.toContain('aaaaa')
  })

  test('keeps at least one chunk even if it alone exceeds cap', () => {
    const r = createRing(5)
    r.push(Buffer.from('a-very-long-chunk-bigger-than-cap'))
    expect(r.chunks.length).toBeGreaterThanOrEqual(1)
  })

  test('compacts internal head pointer over many pushes', () => {
    const r = createRing(50)
    for (let i = 0; i < 100; i++) r.push(Buffer.from(`chunk${i};`))
    // After 100 pushes against cap=50, the dropped-prefix should be
    // compacted. Verify the public chunks list has reasonable size.
    expect(r.chunks.length).toBeLessThan(100)
    const total = r.chunks.reduce((n, c) => n + c.length, 0)
    expect(total).toBeLessThanOrEqual(50)
  })

  test('handles single-chunk push at exactly the cap boundary', () => {
    const r = createRing(8)
    r.push(Buffer.from('abcdefgh')) // exactly 8
    expect(r.chunks.map(c => c.toString()).join('')).toBe('abcdefgh')
    r.push(Buffer.from('X'))
    // Now total is 9 bytes across 2 chunks; first is dropped.
    const joined = r.chunks.map(c => c.toString()).join('')
    expect(joined.length).toBeLessThanOrEqual(8)
    expect(joined).toContain('X')
  })

  test('strips utf-8 continuation bytes after dropping a head chunk', () => {
    // Construct a chunk where the boundary lands mid-codepoint after eviction.
    // We'll evict a 4-byte chunk + leave a chunk that starts with 2
    // continuation bytes (0x80-0xbf range). The ring should strip up to 3
    // continuation bytes from the new head so chunks[0] starts on a
    // valid codepoint boundary.
    const r = createRing(6)
    r.push(Buffer.from([0x41, 0x42, 0x43, 0x44])) // "ABCD" → will be dropped
    // Continuation bytes followed by an ASCII byte.
    r.push(Buffer.from([0x80, 0x81, 0x42, 0x43, 0x44])) // 0x80,0x81 are continuation; 0x42='B'
    // Total now 9 bytes > cap=6; oldest dropped (4 bytes), leaving a 5-byte
    // chunk that starts with 2 continuation bytes. Trim should remove them.
    const head = r.chunks[0]
    expect(head).toBeDefined()
    if (head) {
      expect(head.length).toBeGreaterThan(0)
      // First byte should NOT be a continuation byte.
      expect((head[0]! & 0xc0) === 0x80).toBe(false)
    }
  })

  test('chunks getter is idempotent', () => {
    const r = createRing(100)
    r.push(Buffer.from('abc'))
    expect(r.chunks).toEqual(r.chunks)
  })
})
