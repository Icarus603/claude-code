import { describe, expect, test } from 'bun:test'
import {
  sanitizeModelName,
  sanitizeSurfaceKey,
} from '../commitAttribution.js'

describe('sanitizeModelName — Opus family', () => {
  test('opus-4-7 variants → claude-opus-4-7', () => {
    expect(sanitizeModelName('opus-4-7')).toBe('claude-opus-4-7')
    expect(sanitizeModelName('opus-4-7-fast')).toBe('claude-opus-4-7')
    expect(sanitizeModelName('opus-4-7-internal')).toBe('claude-opus-4-7')
  })
  test('opus-4-6 → claude-opus-4-6', () => {
    expect(sanitizeModelName('opus-4-6')).toBe('claude-opus-4-6')
  })
  test('opus-4-5 → claude-opus-4-5', () => {
    expect(sanitizeModelName('opus-4-5-fast')).toBe('claude-opus-4-5')
  })
  test('opus-4-1 → claude-opus-4-1', () => {
    expect(sanitizeModelName('opus-4-1')).toBe('claude-opus-4-1')
  })
  test('opus-4 (bare) → claude-opus-4', () => {
    expect(sanitizeModelName('opus-4')).toBe('claude-opus-4')
  })
  test('priority: opus-4-7 wins over opus-4 (longest prefix first in source)', () => {
    // Since the function is implemented as a sequence of `if includes`, more
    // specific matches should win. Verify ordering.
    expect(sanitizeModelName('opus-4-7')).not.toBe('claude-opus-4')
  })
})

describe('sanitizeModelName — Sonnet family', () => {
  test('sonnet-4-6 → claude-sonnet-4-6', () => {
    expect(sanitizeModelName('sonnet-4-6')).toBe('claude-sonnet-4-6')
  })
  test('sonnet-4-5 → claude-sonnet-4-5', () => {
    expect(sanitizeModelName('sonnet-4-5')).toBe('claude-sonnet-4-5')
  })
  test('sonnet-4 (bare) → claude-sonnet-4', () => {
    expect(sanitizeModelName('sonnet-4')).toBe('claude-sonnet-4')
  })
  test('sonnet-3-7 → claude-sonnet-3-7', () => {
    expect(sanitizeModelName('sonnet-3-7')).toBe('claude-sonnet-3-7')
  })
})

describe('sanitizeModelName — Haiku family', () => {
  test('haiku-4-5 → claude-haiku-4-5', () => {
    expect(sanitizeModelName('haiku-4-5')).toBe('claude-haiku-4-5')
  })
  test('haiku-3-5 → claude-haiku-3-5', () => {
    expect(sanitizeModelName('haiku-3-5')).toBe('claude-haiku-3-5')
  })
})

describe('sanitizeModelName — unknown fallback', () => {
  test('unknown name → "claude"', () => {
    expect(sanitizeModelName('gpt-4')).toBe('claude')
    expect(sanitizeModelName('llama-3')).toBe('claude')
    expect(sanitizeModelName('')).toBe('claude')
  })
})

describe('sanitizeSurfaceKey', () => {
  test('replaces only the model portion after last /', () => {
    expect(sanitizeSurfaceKey('cli/opus-4-5-fast')).toBe('cli/claude-opus-4-5')
    expect(sanitizeSurfaceKey('repl/sonnet-4-6')).toBe('repl/claude-sonnet-4-6')
  })
  test('preserves multi-segment surfaces (uses LAST /)', () => {
    expect(sanitizeSurfaceKey('cli/sub/opus-4-7')).toBe('cli/sub/claude-opus-4-7')
  })
  test('passes through when no / (no model portion)', () => {
    expect(sanitizeSurfaceKey('plain')).toBe('plain')
  })
  test('unknown model in surface → "claude"', () => {
    expect(sanitizeSurfaceKey('cli/unknown-model')).toBe('cli/claude')
  })
  test('empty model after / → "claude"', () => {
    expect(sanitizeSurfaceKey('cli/')).toBe('cli/claude')
  })
})
