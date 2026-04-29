import { describe, expect, test } from 'bun:test'
import { stripBOM } from '../jsonRead.js'

describe('stripBOM — UTF-8 BOM handling', () => {
  // Why this exists: PowerShell 5.x writes UTF-8 with BOM by default
  // (Out-File, Set-Content). Without stripping, JSON.parse fails with
  // "Unexpected token". The function is a 1-liner, but the BOM=U+FEFF
  // contract is exact and easy to break (e.g., someone might "simplify"
  // by using a different UTF-8 encoding marker).

  test('removes leading BOM', () => {
    expect(stripBOM('\uFEFF{"k":1}')).toBe('{"k":1}')
  })

  test('does not modify content without BOM', () => {
    expect(stripBOM('{"k":1}')).toBe('{"k":1}')
  })

  test('only strips ONE BOM (not multiple consecutive)', () => {
    // Contract: only the leading char is checked. If a file somehow
    // has a double-BOM (highly unusual but possible from bad encoder),
    // we leave the second one in place. Caller can re-call if needed.
    expect(stripBOM('\uFEFF\uFEFF{"k":1}')).toBe('\uFEFF{"k":1}')
  })

  test('BOM in middle is NOT stripped (only leading)', () => {
    // U+FEFF is a valid (zero-width) char in UTF-8 strings; only the
    // BOM-as-encoding-marker at position 0 is the issue.
    expect(stripBOM('{"k":1}\uFEFFsuffix')).toBe('{"k":1}\uFEFFsuffix')
  })

  test('empty string returns empty string', () => {
    expect(stripBOM('')).toBe('')
  })

  test('single BOM char only returns empty string', () => {
    expect(stripBOM('\uFEFF')).toBe('')
  })

  test('handles multi-line JSON with BOM', () => {
    const input = '\uFEFF{\n  "key": "value"\n}\n'
    const expected = '{\n  "key": "value"\n}\n'
    expect(stripBOM(input)).toBe(expected)
  })

  test('non-BOM unicode chars at start are preserved', () => {
    // ZWJ (U+200D), regular space, accented chars — none are BOM.
    expect(stripBOM(' \u200D{"k":1}')).toBe(' \u200D{"k":1}')
    expect(stripBOM('é{"k":1}')).toBe('é{"k":1}')
  })

  test('after stripping, JSON.parse succeeds on what was previously broken', () => {
    // End-to-end smoke: BOM + JSON → strip → parse works.
    const broken = '\uFEFF{"k":1}'
    expect(() => JSON.parse(broken)).toThrow()
    expect(JSON.parse(stripBOM(broken))).toEqual({ k: 1 })
  })

  test('output is identical to input when input has no leading BOM (no copy)', () => {
    // Optional but nice: per the implementation `s.startsWith ? slice : s`,
    // when no BOM, the SAME string reference is returned. JS strings are
    // immutable, so reference equality is the same as value equality, but
    // documenting this saves a substring allocation in the common case.
    const input = '{"k":1}'
    expect(stripBOM(input)).toBe(input)
  })
})
