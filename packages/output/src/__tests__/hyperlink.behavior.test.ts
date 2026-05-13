import { describe, expect, test } from 'bun:test'

import { OSC8_END, OSC8_START, createHyperlink } from '../hyperlink.ts'

/**
 * Pin OSC 8 hyperlink escape sequence format. These show in REPL output,
 * GH PR links, login URLs, and many other places. Wrong escape format →
 * users see literal escape characters instead of clickable links.
 */
describe('OSC 8 hyperlink', () => {
  test('OSC8_START = "\\x1b]8;;" (CSI hyperlink intro)', () => {
    expect(OSC8_START).toBe('\x1b]8;;')
  })

  test('OSC8_END = "\\x07" (BEL terminator, more widely supported than ST)', () => {
    // The doc comment specifically notes BEL is more widely supported
    // than the ST (\x1b\\) terminator. Pin so a refactor doesn't switch.
    expect(OSC8_END).toBe('\x07')
  })

  test('createHyperlink with supportsHyperlinks=false → plain URL', () => {
    // Important fallback: terminals that don't support OSC 8 must see
    // the bare URL (clickable in most modern terminals via URL detection)
    // instead of a string of escape characters.
    expect(createHyperlink('https://example.com', undefined, { supportsHyperlinks: false })).toBe(
      'https://example.com',
    )
  })

  test('createHyperlink with content + no support → plain URL (content IGNORED)', () => {
    // Pin the "content ignored when no support" behavior. Returning just
    // the URL keeps the link clickable in URL-detecting terminals; returning
    // the content would show "click here" with no URL at all.
    expect(
      createHyperlink('https://example.com', 'click here', { supportsHyperlinks: false }),
    ).toBe('https://example.com')
  })

  test('createHyperlink with support → OSC8-wrapped colored text', () => {
    const result = createHyperlink('https://example.com', 'click here', {
      supportsHyperlinks: true,
    })
    expect(result).toContain('\x1b]8;;https://example.com\x07')
    expect(result).toContain('click here')
    // Ends with the closing OSC 8 sequence (empty URL means "end link")
    expect(result).toContain('\x1b]8;;\x07')
  })

  test('createHyperlink with support + no content → URL as display text', () => {
    const result = createHyperlink('https://example.com', undefined, {
      supportsHyperlinks: true,
    })
    expect(result).toContain('\x1b]8;;https://example.com\x07')
    expect(result).toContain('example.com')
  })

  test('display text uses chalk.blue (source-level pin)', () => {
    // The comment specifically says: "ANSI blue color — wrap-ansi preserves
    // this across line breaks. RGB colors (like theme colors) are NOT
    // preserved by wrap-ansi with OSC 8". Pin chalk.blue (ANSI 16-color)
    // so theme refactors don't accidentally swap to chalk.hex.
    // Direct chalk.blue invocation is hidden when chalk is disabled in
    // test env, so pin via source check.
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'hyperlink.ts'), 'utf-8')
    expect(source).toMatch(/chalk\.blue\(displayText\)/)
  })
})
