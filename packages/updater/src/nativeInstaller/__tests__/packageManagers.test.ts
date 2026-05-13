/**
 * Tests for `detectBrewFormulaName` — port-correctness against ant
 * v2.1.136 `Vw_` (3481.js):
 *
 *   function Vw_() {
 *     return (process.execPath || process.argv[0] || "")
 *       .match(/\/Caskroom\/([^/]+)\//)?.[1] ?? null
 *   }
 *
 * The function only inspects `process.execPath` so we can stub it
 * directly in each test case. Save/restore the original to keep
 * test isolation.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { detectBrewFormulaName } from '../packageManagers.js'

const ORIGINAL_EXEC_PATH = process.execPath

afterEach(() => {
  Object.defineProperty(process, 'execPath', {
    value: ORIGINAL_EXEC_PATH,
    configurable: true,
    writable: false,
  })
})

function setExecPath(path: string): void {
  Object.defineProperty(process, 'execPath', {
    value: path,
    configurable: true,
    writable: false,
  })
}

describe('detectBrewFormulaName (ant Vw_)', () => {
  test('extracts cask name from /opt/homebrew/Caskroom/<name>/<version>', () => {
    setExecPath('/opt/homebrew/Caskroom/claude-code/2.1.136/claude')
    expect(detectBrewFormulaName()).toBe('claude-code')
  })

  test('extracts the @latest variant', () => {
    setExecPath(
      '/opt/homebrew/Caskroom/claude-code@latest/2.1.137-dev/claude',
    )
    expect(detectBrewFormulaName()).toBe('claude-code@latest')
  })

  test('handles Linux Homebrew path /home/linuxbrew/.linuxbrew/Caskroom/...', () => {
    setExecPath(
      '/home/linuxbrew/.linuxbrew/Caskroom/claude-code/2.1.136/claude',
    )
    expect(detectBrewFormulaName()).toBe('claude-code')
  })

  test('returns null when path has no /Caskroom/ segment', () => {
    setExecPath('/usr/local/bin/claude')
    expect(detectBrewFormulaName()).toBeNull()
  })

  test('returns null when path contains caskroom in lowercase only (case-sensitive)', () => {
    // Homebrew uses capital-C `Caskroom` (case-sensitive on Linux FS,
    // case-insensitive on macOS HFS+ but the path is always cased that
    // way). ant's regex is case-sensitive — we mirror that.
    setExecPath('/opt/homebrew/caskroom/claude-code/2.1.136/claude')
    expect(detectBrewFormulaName()).toBeNull()
  })

  test('returns null for empty execPath', () => {
    setExecPath('')
    expect(detectBrewFormulaName()).toBeNull()
  })

  test('extracts only the FIRST Caskroom segment (no nesting)', () => {
    // Defensive: if a path somehow contains two /Caskroom/ markers
    // (symlinks, weird homebrew setups), the regex captures the first
    // hit (ant's `match()` returns the first match, not all).
    setExecPath(
      '/opt/homebrew/Caskroom/outer/some/Caskroom/inner/2.1.136/claude',
    )
    expect(detectBrewFormulaName()).toBe('outer')
  })

  test('handles cask name with version-style chars (dot, plus, hyphen, at)', () => {
    setExecPath('/opt/homebrew/Caskroom/claude-code-cli@1.0+beta/2.1.136/c')
    expect(detectBrewFormulaName()).toBe('claude-code-cli@1.0+beta')
  })
})
