import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'os'
import { sep } from 'path'
import { generateTempFilePath } from '../tempfile.js'

describe('generateTempFilePath — defaults', () => {
  test('uses default prefix "claude-prompt"', () => {
    const p = generateTempFilePath()
    expect(p).toContain('claude-prompt-')
  })

  test('uses default extension ".md"', () => {
    expect(generateTempFilePath()).toMatch(/\.md$/)
  })

  test('placed under tmpdir()', () => {
    const p = generateTempFilePath()
    expect(p.startsWith(tmpdir() + sep) || p.startsWith(tmpdir() + '/')).toBe(true)
  })
})

describe('generateTempFilePath — custom prefix and extension', () => {
  test('honors custom prefix', () => {
    expect(generateTempFilePath('myprefix')).toContain('myprefix-')
  })

  test('honors custom extension', () => {
    expect(generateTempFilePath('p', '.json')).toMatch(/\.json$/)
  })

  test('extension passed as-is (no dot inserted)', () => {
    // Documents: caller must include the dot. ".md" → ".md", "md" → "md".
    expect(generateTempFilePath('p', 'noext')).toMatch(/-[\da-f]+noext$/i)
  })
})

describe('generateTempFilePath — random UUID path (no contentHash)', () => {
  test('two consecutive calls produce different paths', () => {
    expect(generateTempFilePath()).not.toBe(generateTempFilePath())
  })

  test('100 distinct calls produce 100 distinct paths', () => {
    const paths = new Set<string>()
    for (let i = 0; i < 100; i++) paths.add(generateTempFilePath())
    expect(paths.size).toBe(100)
  })

  test('UUID identifier is 36 chars (canonical UUID v4 form)', () => {
    // randomUUID returns "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" (36 chars).
    const p = generateTempFilePath('test', '.x')
    // After "test-" and before ".x" should be 36 chars.
    const match = p.match(/test-([\w-]+)\.x$/)
    expect(match?.[1]?.length).toBe(36)
  })
})

describe('generateTempFilePath — contentHash path', () => {
  // Critical contract: when contentHash is provided, the resulting path
  // is STABLE for the same content across process boundaries. This is
  // required for prompt-cache stability (random UUIDs would invalidate
  // the API cache prefix on every subprocess spawn).

  test('same contentHash produces same path', () => {
    const a = generateTempFilePath('p', '.md', { contentHash: 'sandbox-rules' })
    const b = generateTempFilePath('p', '.md', { contentHash: 'sandbox-rules' })
    expect(a).toBe(b)
  })

  test('different contentHash produces different paths', () => {
    expect(
      generateTempFilePath('p', '.md', { contentHash: 'a' }),
    ).not.toBe(generateTempFilePath('p', '.md', { contentHash: 'b' }))
  })

  test('contentHash uses SHA-256 first 16 hex chars', () => {
    // Identifier should be exactly 16 lowercase hex chars.
    const p = generateTempFilePath('test', '.x', { contentHash: 'foo' })
    const match = p.match(/test-([0-9a-f]+)\.x$/)
    expect(match?.[1]?.length).toBe(16)
  })

  test('contentHash with same content but different prefix produces different paths (prefix is part of name)', () => {
    expect(
      generateTempFilePath('a', '.md', { contentHash: 'foo' }),
    ).not.toBe(generateTempFilePath('b', '.md', { contentHash: 'foo' }))
  })

  test('contentHash with same content but different extension produces different paths', () => {
    expect(
      generateTempFilePath('p', '.md', { contentHash: 'foo' }),
    ).not.toBe(generateTempFilePath('p', '.txt', { contentHash: 'foo' }))
  })

  test('empty-string contentHash falls THROUGH to UUID branch (truthy check)', () => {
    // Trace: `options?.contentHash ? hash() : randomUUID()`. The ternary
    // condition checks the value's truthiness. Empty string '' is FALSY,
    // so contentHash:'' takes the randomUUID branch — same as not passing
    // contentHash at all. Documents this — callers wanting sha256('')
    // would need a different sentinel.
    const p1 = generateTempFilePath('p', '.md', { contentHash: '' })
    const p2 = generateTempFilePath('p', '.md', { contentHash: '' })
    // Two calls produce DIFFERENT paths because both fell to UUID.
    expect(p1).not.toBe(p2)
    // ID is UUID-shaped (36 chars), not sha256-shaped (16 chars).
    const match = p1.match(/p-([\w-]+)\.md$/)
    expect(match?.[1]?.length).toBe(36)
  })
})

describe('generateTempFilePath — return shape', () => {
  test('returns absolute path', () => {
    const p = generateTempFilePath()
    expect(
      p.startsWith('/') || /^[A-Z]:[/\\]/i.test(p) || p.startsWith('\\\\'),
    ).toBe(true)
  })

  test('result is path-join correct (no double separators)', () => {
    const p = generateTempFilePath('test', '.md')
    expect(p).not.toContain('//')
  })
})
