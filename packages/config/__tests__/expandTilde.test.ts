import { describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import { expandTilde } from '../utils/expandTilde.js'

const HOME = homedir()

describe('expandTilde', () => {
  test('bare ~ expands to home', () => {
    expect(expandTilde('~')).toBe(HOME)
  })
  test('~/foo expands to home/foo', () => {
    expect(expandTilde('~/foo/bar.txt')).toBe(`${HOME}/foo/bar.txt`)
  })
  test('paths without leading ~ are unchanged', () => {
    expect(expandTilde('/abs/path')).toBe('/abs/path')
    expect(expandTilde('relative/path')).toBe('relative/path')
  })
  test('~user (named user expansion) is NOT supported — returned as-is', () => {
    // Security: avoid resolving other users' homes from ~name syntax.
    expect(expandTilde('~bob/file')).toBe('~bob/file')
  })
  test('empty string is unchanged', () => {
    expect(expandTilde('')).toBe('')
  })
  test('tilde inside a path (not leading) is unchanged', () => {
    expect(expandTilde('/foo/~/bar')).toBe('/foo/~/bar')
  })
})
