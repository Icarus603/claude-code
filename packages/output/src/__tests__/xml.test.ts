import { describe, expect, test } from 'bun:test'
import { escapeXml, escapeXmlAttr } from '../xml.js'

describe('escapeXml — element text content', () => {
  test('returns plain text unchanged', () => {
    expect(escapeXml('hello world')).toBe('hello world')
  })

  test('& → &amp;', () => {
    expect(escapeXml('a & b')).toBe('a &amp; b')
  })

  test('< → &lt;', () => {
    expect(escapeXml('a < b')).toBe('a &lt; b')
  })

  test('> → &gt;', () => {
    expect(escapeXml('a > b')).toBe('a &gt; b')
  })

  test('CRITICAL — & is escaped FIRST (avoid double-escape)', () => {
    // `<` becomes `&lt;`. If `&` were escaped after `<`, the literal `&`
    // in `&lt;` would become `&amp;lt;` — double-escape. The replace order
    // (`&` first) prevents this. This test guards the contract.
    expect(escapeXml('<')).toBe('&lt;')
    expect(escapeXml('&')).toBe('&amp;')
    // Mixed: input has both `&` and `<`. Verify neither doubles up.
    expect(escapeXml('& <')).toBe('&amp; &lt;')
  })

  test('quotes (\') and (") NOT escaped (text content allows them)', () => {
    // Quotes only need escaping inside attribute values — not text content.
    expect(escapeXml(`"quoted" 'single'`)).toBe(`"quoted" 'single'`)
  })

  test('empty string → empty', () => {
    expect(escapeXml('')).toBe('')
  })

  test('multiple instances all replaced (replaceAll semantics)', () => {
    expect(escapeXml('<<<')).toBe('&lt;&lt;&lt;')
    expect(escapeXml('& & &')).toBe('&amp; &amp; &amp;')
  })

  test('XML injection-style payload neutralized', () => {
    // Classic XSS / XML-injection vector — must become innocuous text.
    expect(escapeXml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
  })

  test('does NOT decode pre-escaped entities (idempotency NOT a goal)', () => {
    // If user passes already-escaped input, we DOUBLE-escape — this is
    // expected because we cannot tell encoded vs raw. Document this so
    // callers don't pass entity-encoded text by mistake.
    expect(escapeXml('&amp;')).toBe('&amp;amp;')
  })

  test('unicode preserved', () => {
    // Non-XML-special chars pass through, including emoji and CJK.
    expect(escapeXml('你好 🌟')).toBe('你好 🌟')
  })

  test('newlines and tabs preserved', () => {
    expect(escapeXml('line1\nline2\ttab')).toBe('line1\nline2\ttab')
  })
})

describe('escapeXmlAttr — attribute values', () => {
  test('plain text unchanged', () => {
    expect(escapeXmlAttr('hello')).toBe('hello')
  })

  test('XML-text escapes ALSO applied (delegates to escapeXml first)', () => {
    expect(escapeXmlAttr('<tag>')).toBe('&lt;tag&gt;')
    expect(escapeXmlAttr('A & B')).toBe('A &amp; B')
  })

  test('" → &quot; (additional vs escapeXml)', () => {
    expect(escapeXmlAttr('"quoted"')).toBe('&quot;quoted&quot;')
  })

  test("' → &apos; (additional vs escapeXml)", () => {
    expect(escapeXmlAttr("can't")).toBe('can&apos;t')
  })

  test('mixed: all 5 chars escaped', () => {
    expect(escapeXmlAttr(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&apos;y&apos;&gt;&amp;&lt;/a&gt;',
    )
  })

  test('attribute injection vector neutralized', () => {
    // Classic attribute-injection XSS: `" onload="alert(1)`. After escape
    // the quotes are entities → safe to interpolate as `<tag attr="${x}">`.
    expect(escapeXmlAttr('" onload="alert(1)')).toBe(
      '&quot; onload=&quot;alert(1)',
    )
  })

  test('empty string → empty', () => {
    expect(escapeXmlAttr('')).toBe('')
  })

  test('quote-escape order: & is BEFORE quote escape', () => {
    // Same double-escape concern: if `"` were escaped first to `&quot;`,
    // a subsequent `&` pass would convert that `&` to `&amp;` →
    // `&amp;quot;`. The function calls escapeXml() first (which handles
    // `&`), then replaces quotes — so the produced `&quot;`/`&apos;`
    // entities are never re-processed.
    expect(escapeXmlAttr('"&')).toBe('&quot;&amp;')
    // Verify the reverse input order produces the symmetric output:
    expect(escapeXmlAttr('&"')).toBe('&amp;&quot;')
  })
})
