import { describe, expect, test } from 'bun:test'
import { sanitizeAgentName, sanitizeName } from '../teamHelpers.js'

describe('sanitizeName', () => {
  test('keeps alphanumerics intact', () => {
    expect(sanitizeName('foo123')).toBe('foo123')
  })
  test('lowercases uppercase letters', () => {
    expect(sanitizeName('FooBar')).toBe('foobar')
  })
  test('replaces spaces with hyphens', () => {
    expect(sanitizeName('hello world')).toBe('hello-world')
  })
  test('replaces underscores with hyphens', () => {
    expect(sanitizeName('hello_world')).toBe('hello-world')
  })
  test('replaces all non-alphanumeric punctuation with hyphens', () => {
    expect(sanitizeName('a@b#c$d.e')).toBe('a-b-c-d-e')
  })
  test('runs of non-alphanumeric chars produce a run of hyphens (NOT collapsed)', () => {
    // Contract: replaces each non-alphanumeric char individually with `-`.
    // It does NOT collapse multiple consecutive non-alphanumerics into one
    // hyphen. If a future change wants collapse behaviour, this test
    // documents the current contract that callers may depend on.
    expect(sanitizeName('a   b')).toBe('a---b')
  })
  test('handles unicode by replacing every non-ASCII letter with `-`', () => {
    // The regex is ASCII-only — Chinese / accented chars are non-alphanumeric
    // by this definition, so they get replaced.
    expect(sanitizeName('hello世界')).toBe('hello--')
  })
  test('empty string round-trips', () => {
    expect(sanitizeName('')).toBe('')
  })
  test('all non-alphanumeric input becomes all hyphens', () => {
    expect(sanitizeName('!@#')).toBe('---')
  })
})

describe('sanitizeAgentName', () => {
  test('replaces @ with -', () => {
    expect(sanitizeAgentName('agent@team')).toBe('agent-team')
  })
  test('multiple @ are all replaced', () => {
    expect(sanitizeAgentName('a@b@c')).toBe('a-b-c')
  })
  test('non-@ characters are NOT touched (unlike sanitizeName)', () => {
    // sanitizeName would lowercase + replace dots; sanitizeAgentName ONLY
    // touches @. This contract matters because agent IDs use this as part
    // of the deterministic ID format and case-preservation is intentional.
    expect(sanitizeAgentName('FooBar.team')).toBe('FooBar.team')
  })
  test('empty string round-trips', () => {
    expect(sanitizeAgentName('')).toBe('')
  })
  test('preserves digits and hyphens', () => {
    expect(sanitizeAgentName('agent-123')).toBe('agent-123')
  })
})
