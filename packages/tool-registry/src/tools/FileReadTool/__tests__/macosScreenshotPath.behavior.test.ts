import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for macOS screenshot path resolution. The narrow no-break
 * space (U+202F) appears in screenshot filenames on newer macOS versions,
 * but transcripts and Slack-shared paths sometimes get re-typed as regular
 * space (U+0020). The FileReadTool tries the alternate before failing.
 *
 * Bug history: a "let's normalize all whitespace" refactor would replace
 * \u202F → ' ' early, breaking the file lookup because the actual file on
 * disk has the thin space. Pin both directions of the swap so the
 * heuristic stays correct.
 */
describe('macOS thin-space screenshot path handling', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'FileReadTool.ts'),
    'utf-8',
  )

  test('THIN_SPACE constant is U+202F (narrow no-break space) NOT U+0020', () => {
    expect(source).toMatch(/const THIN_SPACE = String\.fromCharCode\(8239\)/)
  })

  test('regex matches AM/PM with either regular or thin space before it', () => {
    // /^(.+)([ \u202F])(AM|PM)(\.png)$/ — the character class
    // includes BOTH space variants. A future "simplify regex" pass that
    // drops the \u202F would break thin-space-named files entirely.
    expect(source).toMatch(/amPmPattern\s*=\s*\/\^\(\.\+\)\(\[ \\u202F\]\)\(AM\|PM\)\(\\\.png\)\$\//)
  })

  test('swap logic: if currentSpace is regular space, use THIN_SPACE; else use regular', () => {
    expect(source).toMatch(
      /alternateSpace = currentSpace === ' '\s*\?\s*THIN_SPACE\s*:\s*' '/,
    )
  })

  test('only attempted on .png files (matches macOS default screenshot format)', () => {
    // The regex anchor: ...(\.png)$ — anchored to the end. Pin so a
    // refactor that loosens to .png* (matching .png-renamed.txt) doesn't
    // start firing on non-screenshots.
    // In source the regex literal is: \.png)$ — escape only the dot.
    expect(source).toContain('\\.png)$')
  })

  test('isBlockedDevicePath covers /dev/null + /proc/self/fd stdio aliases', () => {
    // Bash-tool pipes (cat < /dev/null) and process /proc/self/fd/0 reads
    // would otherwise loop forever (infinite zero bytes on /dev/null, etc.).
    expect(source).toMatch(/BLOCKED_DEVICE_PATHS\.has\(filePath\)/)
    expect(source).toMatch(/filePath\.startsWith\('\/proc\/'\)/)
    expect(source).toMatch(/filePath\.endsWith\('\/fd\/0'\)/)
    expect(source).toMatch(/filePath\.endsWith\('\/fd\/1'\)/)
    expect(source).toMatch(/filePath\.endsWith\('\/fd\/2'\)/)
  })
})
