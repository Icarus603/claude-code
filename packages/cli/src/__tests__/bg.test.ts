import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tailFile } from '../bg.js'

let workDir: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'bg-test-'))
  mkdirSync(workDir, { recursive: true })
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

const writeLog = (name: string, content: string): string => {
  const p = join(workDir, name)
  writeFileSync(p, content)
  return p
}

describe('tailFile', () => {
  test('returns empty for nonexistent file', () => {
    expect(tailFile(join(workDir, 'no-such-file'), 10)).toBe('')
  })

  test('returns empty for zero/negative line count', () => {
    const p = writeLog('a.log', 'one\ntwo\nthree\n')
    expect(tailFile(p, 0)).toBe('')
    expect(tailFile(p, -1)).toBe('')
  })

  test('returns empty for empty file', () => {
    const p = writeLog('empty.log', '')
    expect(tailFile(p, 5)).toBe('')
  })

  test('preserves no-trailing-newline file shape', () => {
    const p = writeLog('no-trail.log', 'a\nb\nc')
    expect(tailFile(p, 2)).toBe('b\nc')
  })

  test('preserves trailing-newline file shape', () => {
    const p = writeLog('trail.log', 'a\nb\nc\n')
    expect(tailFile(p, 2)).toBe('b\nc\n')
  })

  test('returns whole file when requested tail exceeds line count', () => {
    const p = writeLog('small.log', 'x\ny\nz\n')
    expect(tailFile(p, 1000)).toBe('x\ny\nz\n')
  })

  test('handles single-line file (no internal newlines)', () => {
    const p = writeLog('single-noterm.log', 'just one line')
    expect(tailFile(p, 5)).toBe('just one line')
    const p2 = writeLog('single-term.log', 'just one line\n')
    expect(tailFile(p2, 5)).toBe('just one line\n')
  })

  test('handles a 1000-line file with a small tail', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => String(i + 1))
    const p = writeLog('big.log', lines.join('\n') + '\n')
    expect(tailFile(p, 5)).toBe('996\n997\n998\n999\n1000\n')
  })

  test('handles content larger than the 64 KB chunk', () => {
    // 100k lines × ~7 bytes = ~700 KB → well past CHUNK boundary
    const lines = Array.from({ length: 100_000 }, (_, i) => `line${i}`)
    const p = writeLog('huge.log', lines.join('\n') + '\n')
    const tail = tailFile(p, 3)
    expect(tail).toBe('line99997\nline99998\nline99999\n')
  })

  test('handles tail-count exactly matching line count', () => {
    const p = writeLog('exact.log', 'a\nb\nc\n')
    expect(tailFile(p, 3)).toBe('a\nb\nc\n')
  })
})
