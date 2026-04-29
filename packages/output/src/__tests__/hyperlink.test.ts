import { describe, expect, test } from 'bun:test'
import {
  OSC8_END,
  OSC8_START,
  createHyperlink,
} from '../hyperlink.js'

describe('OSC8 escape codes — wire-format anchor', () => {
  // The OSC 8 hyperlink escape format is a hard ANSI standard. If
  // these constants drift, every terminal hyperlink in ccb breaks.

  test('OSC8_START is ESC ] 8 ; ;', () => {
    expect(OSC8_START).toBe('\x1b]8;;')
  })

  test('OSC8_END is BEL (0x07)', () => {
    // Spec allows ESC \\ or BEL; we use BEL for wider terminal support.
    expect(OSC8_END).toBe('\x07')
  })
})

describe('createHyperlink — supports=false (plain text fallback)', () => {
  test('returns URL only when terminal does not support hyperlinks', () => {
    const result = createHyperlink('https://example.com', undefined, {
      supportsHyperlinks: false,
    })
    expect(result).toBe('https://example.com')
  })

  test('content parameter is IGNORED when hyperlinks unsupported', () => {
    // Critical contract: in non-supporting terminals, the user sees
    // the raw URL, NOT the content. This avoids the silent-bug shape
    // where a "click here" link in copy-paste output drops the URL.
    const result = createHyperlink('https://example.com', 'click here', {
      supportsHyperlinks: false,
    })
    expect(result).toBe('https://example.com')
    expect(result).not.toContain('click here')
  })

  test('returns URL string with no escape codes when unsupported', () => {
    const result = createHyperlink('https://example.com', 'text', {
      supportsHyperlinks: false,
    })
    expect(result).not.toContain(OSC8_START)
    expect(result).not.toContain(OSC8_END)
  })
})

describe('createHyperlink — supports=true (OSC 8 wrapped)', () => {
  test('wraps URL with OSC8_START / OSC8_END', () => {
    const result = createHyperlink('https://example.com', undefined, {
      supportsHyperlinks: true,
    })
    expect(result).toContain(OSC8_START)
    expect(result).toContain(OSC8_END)
    expect(result).toContain('https://example.com')
  })

  test('uses URL as display text when content is undefined', () => {
    const result = createHyperlink('https://example.com', undefined, {
      supportsHyperlinks: true,
    })
    // The URL appears twice: once as the link target, once as
    // the (chalk-colored) display text.
    const matches = result.match(/example\.com/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  test('uses content as display text when provided', () => {
    const result = createHyperlink('https://example.com', 'click me', {
      supportsHyperlinks: true,
    })
    expect(result).toContain('https://example.com')
    expect(result).toContain('click me')
  })

  test('display text passes through chalk.blue (idempotent in non-color terminals)', () => {
    // Chalk blue applies ANSI ESC[34m foreground only when the
    // terminal supports color (FORCE_COLOR / isatty). In bun:test
    // chalk auto-detects no-color, so the result is just the
    // display text. The contract is: chalk.blue() is called, but
    // its actual effect depends on terminal detection. We verify
    // the display text is present, which is the load-bearing part.
    const result = createHyperlink('https://example.com', 'visit', {
      supportsHyperlinks: true,
    })
    expect(result).toContain('visit')
  })

  test('full structure matches OSC8 standard form', () => {
    const result = createHyperlink('https://e.com', 'X', {
      supportsHyperlinks: true,
    })
    // Format: ESC]8;;URL BEL DISPLAY ESC]8;; BEL
    // Verify the close-tag (empty URL) follows the display text.
    expect(result.endsWith(`${OSC8_START}${OSC8_END}`)).toBe(true)
  })
})

describe('createHyperlink — auto-detect (no options)', () => {
  test('does not throw when options is omitted (auto-detect path)', () => {
    // Auto-detect uses supportsHyperlinks() from @anthropic/ink. We
    // can't reliably mock that for this test, but we can verify the
    // function returns SOMETHING without throwing.
    expect(() => createHyperlink('https://example.com')).not.toThrow()
    const result = createHyperlink('https://example.com')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  test('result is a string (typeof check)', () => {
    expect(typeof createHyperlink('https://example.com')).toBe('string')
  })
})

describe('createHyperlink — edge cases', () => {
  test('empty URL', () => {
    const result = createHyperlink('', undefined, { supportsHyperlinks: true })
    expect(result).toContain(OSC8_START)
  })

  test('URL with special characters', () => {
    const result = createHyperlink(
      'https://example.com/path?q=foo&bar=baz',
      undefined,
      { supportsHyperlinks: true },
    )
    expect(result).toContain('https://example.com/path?q=foo&bar=baz')
  })

  test('content with newlines (supported terminal)', () => {
    const result = createHyperlink('https://e.com', 'line1\nline2', {
      supportsHyperlinks: true,
    })
    expect(result).toContain('line1')
    expect(result).toContain('line2')
  })

  test('content with empty string (supported)', () => {
    const result = createHyperlink('https://e.com', '', {
      supportsHyperlinks: true,
    })
    // content '' is falsy, so the function falls back to using URL
    // as display text via the `content ?? url` operator. Wait — `??`
    // only triggers on null/undefined. '' is NOT null/undefined, so
    // the empty string IS used as the display text.
    expect(result).toContain(OSC8_START)
    // The URL appears as the link target. Display text is '' (empty),
    // so the result has URL + empty colored text + close.
    // Let's just verify it doesn't crash and contains the URL.
    expect(result).toContain('https://e.com')
  })
})
