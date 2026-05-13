import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin NFC unicode normalization on all path setters in state.ts.
 *
 * macOS HFS+ stores filenames in NFD (decomposed); APFS stores as-typed
 * but exposes NFD via getdirentries() AND APFS-specific APIs. Bash/cd
 * tab-completion writes NFC; many editor save-as dialogs write NFC.
 *
 * Without normalization, the same logical path arrives as different
 * strings depending on entry point:
 *   - User types `cd ~/Code/résumé` → NFC `re\u0301sume\u0301`
 *   - Read back from disk (HFS+) → NFD `re\u0301sume\u0301`
 *   - Session-restore from disk → different again
 *
 * Pin so a refactor that drops `.normalize('NFC')` from any of the four
 * setters (originalCwd, projectRoot, cwdState — and ALL the related
 * helpers further down) gets caught.
 */
describe('state.ts path setter NFC normalization', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'state.ts'),
    'utf-8',
  )

  test('setOriginalCwd normalizes to NFC', () => {
    expect(source).toMatch(
      /export function setOriginalCwd\(cwd: string\): void \{[\s\S]*?STATE\.originalCwd = cwd\.normalize\('NFC'\)/,
    )
  })

  test('setProjectRoot normalizes to NFC', () => {
    expect(source).toMatch(
      /export function setProjectRoot\(cwd: string\): void \{[\s\S]*?STATE\.projectRoot = cwd\.normalize\('NFC'\)/,
    )
  })

  test('setCwdState normalizes to NFC', () => {
    expect(source).toMatch(
      /export function setCwdState\(cwd: string\): void \{[\s\S]*?STATE\.cwd = cwd\.normalize\('NFC'\)/,
    )
  })

  test('getProjectRoot returns the stored value WITHOUT re-normalizing (immutable post-set)', () => {
    // The setter normalizes ONCE; the getter must not double-process,
    // else cached paths become unstable identifiers.
    const fnStart = source.indexOf('export function getProjectRoot')
    const fnEnd = source.indexOf('\n}', fnStart) + 2
    const fnSlice = source.slice(fnStart, fnEnd)
    expect(fnSlice).toMatch(/return STATE\.projectRoot/)
    expect(fnSlice).not.toContain('.normalize')
  })

  test('setProjectRoot doc warns about EnterWorktreeTool (skills/history stability)', () => {
    // Pin the doc — without this, a future caller might think it's safe
    // to mid-session reassign projectRoot, breaking skill/history scoping.
    expect(source).toMatch(
      /Mid-session EnterWorktreeTool must NOT[\s\S]*?call this[\s\S]*?skills\/history should stay anchored/,
    )
  })
})
