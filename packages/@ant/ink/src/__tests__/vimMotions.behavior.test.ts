import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  isInclusiveMotion,
  isLinewiseMotion,
} from '../vim/motions.ts'

/**
 * Pin `vim/motions.ts` — vim motion key dispatch in REPL prompt input.
 *
 * Critical invariants:
 *  1. Inclusive motions: e, E, $ (motion endpoint INCLUDED in selection).
 *  2. Linewise motions: j, k, G, gg (operates on whole lines).
 *  3. Key dispatch matches vim conventions:
 *     - h/l (left/right), j/k (down/up logical line), gj/gk (visual line)
 *     - w/b/e word motions; W/B/E WORD (whitespace-sep) motions
 *     - 0 (line start), ^ (first non-blank), $ (line end)
 *     - G (start of last line)
 *  4. count repetition uses an early-break: when applying a motion N times,
 *     if a step doesn't change cursor (e.g., at boundary), STOP — don't
 *     spin needlessly.
 *  5. Unknown keys → cursor unchanged (no crash).
 */
describe('vim motions — classification', () => {
  describe('isInclusiveMotion', () => {
    test('e → true (end-of-word, inclusive of last char)', () => {
      expect(isInclusiveMotion('e')).toBe(true)
    })

    test('E → true (end-of-WORD)', () => {
      expect(isInclusiveMotion('E')).toBe(true)
    })

    test('$ → true (end-of-line)', () => {
      expect(isInclusiveMotion('$')).toBe(true)
    })

    test('w/b/h/l → false (exclusive)', () => {
      // Pin: word-start motions are exclusive. h/l obvious.
      expect(isInclusiveMotion('w')).toBe(false)
      expect(isInclusiveMotion('b')).toBe(false)
      expect(isInclusiveMotion('h')).toBe(false)
      expect(isInclusiveMotion('l')).toBe(false)
    })

    test('unknown key → false', () => {
      expect(isInclusiveMotion('q')).toBe(false)
      // Pin behavior: empty string IS classified as inclusive because
      // ''.includes('') === true. Not ideal but matches String.prototype.includes
      // semantics; the caller never passes ''. Document it explicitly.
      expect(isInclusiveMotion('')).toBe(true)
    })
  })

  describe('isLinewiseMotion', () => {
    test('j → true (down logical line)', () => {
      expect(isLinewiseMotion('j')).toBe(true)
    })

    test('k → true (up logical line)', () => {
      expect(isLinewiseMotion('k')).toBe(true)
    })

    test('G → true (start of last line)', () => {
      expect(isLinewiseMotion('G')).toBe(true)
    })

    test('gg → true (start of first line)', () => {
      // Pin: gg is the only multi-char motion classified as linewise.
      expect(isLinewiseMotion('gg')).toBe(true)
    })

    test('h/l/w/e → false (charwise)', () => {
      expect(isLinewiseMotion('h')).toBe(false)
      expect(isLinewiseMotion('l')).toBe(false)
      expect(isLinewiseMotion('w')).toBe(false)
      expect(isLinewiseMotion('e')).toBe(false)
    })

    test('gj/gk → false (visual line, NOT linewise)', () => {
      // Pin: gj/gk move by display line — but they're still charwise
      // for vim operator semantics (NOT linewise).
      expect(isLinewiseMotion('gj')).toBe(false)
      expect(isLinewiseMotion('gk')).toBe(false)
    })

    test('unknown key → false', () => {
      expect(isLinewiseMotion('zz')).toBe(false)
    })
  })
})

describe('vim motions — source pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'vim', 'motions.ts'),
    'utf-8',
  )

  describe('resolveMotion count repetition', () => {
    test('uses early-break when cursor.equals(result)', () => {
      // Pin: avoids infinite loop on boundary motions (e.g., h at line
      // start moves nowhere; 100h MUST not spin).
      expect(source).toMatch(
        /for \(let i = 0; i < count; i\+\+\) \{\s*\n?\s*const next = applySingleMotion\(key, result\)\s*\n?\s*if \(next\.equals\(result\)\) break/,
      )
    })
  })

  describe('Key dispatch table', () => {
    test('h → cursor.left()', () => {
      expect(source).toMatch(/case 'h':\s*\n?\s*return cursor\.left\(\)/)
    })

    test('l → cursor.right()', () => {
      expect(source).toMatch(/case 'l':\s*\n?\s*return cursor\.right\(\)/)
    })

    test('j → cursor.downLogicalLine()', () => {
      // Pin: j moves by LOGICAL line (the cursor's line, not display).
      expect(source).toMatch(
        /case 'j':\s*\n?\s*return cursor\.downLogicalLine\(\)/,
      )
    })

    test('k → cursor.upLogicalLine()', () => {
      expect(source).toMatch(
        /case 'k':\s*\n?\s*return cursor\.upLogicalLine\(\)/,
      )
    })

    test('gj/gk → cursor.down()/up() (visual line motions)', () => {
      // Pin: gj/gk move by DISPLAY line (down() not downLogicalLine()).
      // Distinct from j/k. A regression that confuses these breaks
      // wrap-line navigation.
      expect(source).toMatch(/case 'gj':\s*\n?\s*return cursor\.down\(\)/)
      expect(source).toMatch(/case 'gk':\s*\n?\s*return cursor\.up\(\)/)
    })

    test('w/b/e → vim word boundaries (NOT WORD)', () => {
      // Pin: lowercase uses vim's word definition (alphanumeric + _).
      expect(source).toMatch(/case 'w':\s*\n?\s*return cursor\.nextVimWord\(\)/)
      expect(source).toMatch(/case 'b':\s*\n?\s*return cursor\.prevVimWord\(\)/)
      expect(source).toMatch(/case 'e':\s*\n?\s*return cursor\.endOfVimWord\(\)/)
    })

    test('W/B/E → WORD boundaries (whitespace-separated)', () => {
      // Pin: uppercase = WORD (whitespace-separated). Distinct from w/b/e.
      expect(source).toMatch(/case 'W':\s*\n?\s*return cursor\.nextWORD\(\)/)
      expect(source).toMatch(/case 'B':\s*\n?\s*return cursor\.prevWORD\(\)/)
      expect(source).toMatch(/case 'E':\s*\n?\s*return cursor\.endOfWORD\(\)/)
    })

    test('0 → startOfLogicalLine (NOT first non-blank)', () => {
      // Pin: 0 is column-0 even if blanks. ^ is the first non-blank.
      expect(source).toMatch(
        /case '0':\s*\n?\s*return cursor\.startOfLogicalLine\(\)/,
      )
    })

    test('^ → firstNonBlankInLogicalLine', () => {
      expect(source).toMatch(
        /case '\^':\s*\n?\s*return cursor\.firstNonBlankInLogicalLine\(\)/,
      )
    })

    test('$ → endOfLogicalLine', () => {
      expect(source).toMatch(
        /case '\$':\s*\n?\s*return cursor\.endOfLogicalLine\(\)/,
      )
    })

    test('G → startOfLastLine (move to last line, beginning)', () => {
      expect(source).toMatch(
        /case 'G':\s*\n?\s*return cursor\.startOfLastLine\(\)/,
      )
    })

    test('default branch returns cursor unchanged (no-op on unknown)', () => {
      // Pin: unknown keys don't crash; cursor stays where it was.
      expect(source).toMatch(/default:\s*\n?\s*return cursor/)
    })
  })

  describe('Classification helpers', () => {
    test('isInclusiveMotion: exact string "eE$"', () => {
      // Pin: 3 characters, no spaces. Easy to over- or under-pin.
      expect(source).toMatch(/return 'eE\$'\.includes\(key\)/)
    })

    test('isLinewiseMotion: "jkG" includes + gg special-case', () => {
      // Pin: gg is multi-char so it can't be in the single-char string.
      expect(source).toMatch(
        /return 'jkG'\.includes\(key\) \|\| key === 'gg'/,
      )
    })
  })
})
