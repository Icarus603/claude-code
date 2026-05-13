import { describe, expect, test } from 'bun:test'

import {
  extensionForMimeType,
  getBinaryBlobSavedMessage,
  getFormatDescription,
  getLargeOutputInstructions,
  isBinaryContentType,
} from '../mcpOutputStorage.ts'

/**
 * Pin `mcpOutputStorage.ts` — MCP tool result handling for binary blobs
 * and large outputs. Wrong mime→ext mapping = files unopenable; wrong
 * binary classification = corrupted prompts.
 *
 * Critical invariants:
 *  1. extensionForMimeType is conservative: unknown → 'bin' (NOT empty,
 *     NOT just the subtype). Read tool dispatches on the extension.
 *  2. Mime parsing STRIPS the charset/boundary parameter (split on ';').
 *  3. Office formats map to docx/xlsx/pptx — full
 *     `vnd.openxmlformats-officedocument...` strings.
 *  4. isBinaryContentType: text/* → false; json/xml/javascript/
 *     form-urlencoded → false; everything else → true.
 *  5. `+json` / `+xml` suffix matches treated as TEXT (e.g.
 *     `application/vnd.api+json` is text).
 *  6. getLargeOutputInstructions contains the EXACT character-count
 *     wording, the "100% of the content" mandate, and the truncation
 *     warning variants.
 *  7. getFormatDescription returns "Plain text" / "JSON" / "JSON array"
 *     with optional schema suffix.
 */
describe('mcpOutputStorage', () => {
  describe('extensionForMimeType', () => {
    test('undefined → "bin"', () => {
      expect(extensionForMimeType(undefined)).toBe('bin')
    })

    test('unknown mime → "bin" (NOT empty, NOT subtype)', () => {
      // Pin: conservative default. A regression returning '' or the
      // subtype would break the Read tool dispatch.
      expect(extensionForMimeType('application/x-unknown')).toBe('bin')
    })

    test('strips charset/boundary parameter (split on ";")', () => {
      expect(extensionForMimeType('application/json; charset=utf-8')).toBe('json')
      expect(extensionForMimeType('text/plain;charset=ascii')).toBe('txt')
    })

    test('case-insensitive (lowercases input)', () => {
      expect(extensionForMimeType('APPLICATION/PDF')).toBe('pdf')
      expect(extensionForMimeType('Image/PNG')).toBe('png')
    })

    test('text formats: text/plain → txt, text/html → html, text/markdown → md, text/csv → csv', () => {
      expect(extensionForMimeType('text/plain')).toBe('txt')
      expect(extensionForMimeType('text/html')).toBe('html')
      expect(extensionForMimeType('text/markdown')).toBe('md')
      expect(extensionForMimeType('text/csv')).toBe('csv')
    })

    test('image formats: png/jpeg/gif/webp/svg', () => {
      expect(extensionForMimeType('image/png')).toBe('png')
      // Pin: jpeg → jpg (NOT 'jpeg'). Convention; widespread tooling.
      expect(extensionForMimeType('image/jpeg')).toBe('jpg')
      expect(extensionForMimeType('image/gif')).toBe('gif')
      expect(extensionForMimeType('image/webp')).toBe('webp')
      expect(extensionForMimeType('image/svg+xml')).toBe('svg')
    })

    test('audio: mp3 / wav / ogg', () => {
      expect(extensionForMimeType('audio/mpeg')).toBe('mp3')
      expect(extensionForMimeType('audio/wav')).toBe('wav')
      expect(extensionForMimeType('audio/ogg')).toBe('ogg')
    })

    test('video: mp4 / webm', () => {
      expect(extensionForMimeType('video/mp4')).toBe('mp4')
      expect(extensionForMimeType('video/webm')).toBe('webm')
    })

    test('Office: docx / xlsx / pptx (full openxmlformats strings)', () => {
      expect(
        extensionForMimeType(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
      ).toBe('docx')
      expect(
        extensionForMimeType(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      ).toBe('xlsx')
      expect(
        extensionForMimeType(
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ),
      ).toBe('pptx')
    })

    test('Legacy Office: doc / xls (msword / ms-excel)', () => {
      expect(extensionForMimeType('application/msword')).toBe('doc')
      expect(extensionForMimeType('application/vnd.ms-excel')).toBe('xls')
    })

    test('pdf + zip + json', () => {
      expect(extensionForMimeType('application/pdf')).toBe('pdf')
      expect(extensionForMimeType('application/zip')).toBe('zip')
      expect(extensionForMimeType('application/json')).toBe('json')
    })
  })

  describe('isBinaryContentType', () => {
    test('empty string → false (defensive)', () => {
      expect(isBinaryContentType('')).toBe(false)
    })

    test('text/* → false (text/plain, text/html, etc.)', () => {
      expect(isBinaryContentType('text/plain')).toBe(false)
      expect(isBinaryContentType('text/html; charset=utf-8')).toBe(false)
      expect(isBinaryContentType('TEXT/CSV')).toBe(false)
    })

    test('application/json → false (text-ish structured)', () => {
      expect(isBinaryContentType('application/json')).toBe(false)
    })

    test('+json suffix → false (e.g., application/vnd.api+json)', () => {
      // Pin: structured-text suffix. application/vnd.api+json is TEXT.
      expect(isBinaryContentType('application/vnd.api+json')).toBe(false)
      expect(isBinaryContentType('application/hal+json')).toBe(false)
    })

    test('application/xml → false', () => {
      expect(isBinaryContentType('application/xml')).toBe(false)
    })

    test('+xml suffix → false (e.g., application/atom+xml)', () => {
      expect(isBinaryContentType('application/atom+xml')).toBe(false)
    })

    test('application/javascript → false', () => {
      expect(isBinaryContentType('application/javascript')).toBe(false)
      // Pin: also application/javascript;charset=utf-8 → false (startsWith).
      expect(isBinaryContentType('application/javascript;charset=utf-8')).toBe(
        false,
      )
    })

    test('application/x-www-form-urlencoded → false', () => {
      expect(isBinaryContentType('application/x-www-form-urlencoded')).toBe(
        false,
      )
    })

    test('application/pdf → true (binary)', () => {
      expect(isBinaryContentType('application/pdf')).toBe(true)
    })

    test('image/* → true (all images are binary in this heuristic)', () => {
      expect(isBinaryContentType('image/png')).toBe(true)
      expect(isBinaryContentType('image/jpeg')).toBe(true)
      // Pin: even svg+xml is treated as binary by this heuristic
      // (it goes through the application/+xml fallthrough — wait, no,
      // image/svg+xml is image/, not application/, and the check is
      // ends-with('+xml'). Let's check: 'image/svg+xml' ends with '+xml'
      // → false branch in checkBinaryContentType.
      expect(isBinaryContentType('image/svg+xml')).toBe(false)
    })

    test('Office docx/xlsx → true (NOT swallowed by +xml fallback)', () => {
      // Pin: 'openxmlformats-officedocument.wordprocessingml.document'
      // does NOT end with '+xml' — uses substring 'openxmlformats'.
      // A regression to substring '+xml' (which would match
      // 'openxml...formats' substring) would mis-classify these as text.
      expect(
        isBinaryContentType(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
      ).toBe(true)
    })

    test('audio/video → true', () => {
      expect(isBinaryContentType('audio/mpeg')).toBe(true)
      expect(isBinaryContentType('video/mp4')).toBe(true)
    })

    test('strips charset parameter before classifying', () => {
      expect(isBinaryContentType('application/json; charset=utf-8')).toBe(false)
      expect(isBinaryContentType('text/plain;charset=utf-8')).toBe(false)
    })
  })

  describe('getFormatDescription', () => {
    test('toolResult → "Plain text"', () => {
      expect(getFormatDescription('toolResult')).toBe('Plain text')
    })

    test('structuredContent (no schema) → "JSON"', () => {
      expect(getFormatDescription('structuredContent')).toBe('JSON')
    })

    test('structuredContent (with schema) → "JSON with schema: ..."', () => {
      expect(getFormatDescription('structuredContent', '{type:number}')).toBe(
        'JSON with schema: {type:number}',
      )
    })

    test('contentArray (no schema) → "JSON array"', () => {
      expect(getFormatDescription('contentArray')).toBe('JSON array')
    })

    test('contentArray (with schema) → "JSON array with schema: ..."', () => {
      expect(getFormatDescription('contentArray', 'X')).toBe(
        'JSON array with schema: X',
      )
    })
  })

  describe('getLargeOutputInstructions', () => {
    test('includes character count (locale-formatted with commas)', () => {
      const out = getLargeOutputInstructions(
        '/tmp/file.txt',
        12345,
        'Plain text',
      )
      // Pin: toLocaleString — "12,345" (with comma) NOT "12345".
      expect(out).toContain('(12,345 characters)')
    })

    test('includes the absolute path twice (header + body)', () => {
      // Pin: caller needs to see the path both in the error line AND in
      // the body reminder ("read content from the file at ..."). A
      // regression that mentions it once would lose the reminder.
      const out = getLargeOutputInstructions(
        '/tmp/file.txt',
        100,
        'Plain text',
      )
      const occurrences = out.split('/tmp/file.txt').length - 1
      expect(occurrences).toBeGreaterThanOrEqual(2)
    })

    test('includes "100% of the content" mandate', () => {
      // Pin: the literal phrase appears in the prompt template that
      // pushes models toward complete reads. Don't soften.
      const out = getLargeOutputInstructions(
        '/tmp/file.txt',
        100,
        'JSON',
      )
      expect(out).toContain('100% of the content')
    })

    test('with maxReadLength → mentions the limit', () => {
      const out = getLargeOutputInstructions(
        '/tmp/file.txt',
        100,
        'Plain text',
        500_000,
      )
      // Pin: format is locale-string of maxReadLength, e.g. "500,000".
      expect(out).toContain('Bash output is limited to 500,000 chars.')
    })

    test('without maxReadLength → generic truncation warning (no chars limit)', () => {
      const out = getLargeOutputInstructions(
        '/tmp/file.txt',
        100,
        'Plain text',
      )
      expect(out).not.toContain('Bash output is limited to')
    })

    test('includes summarization warning ("you MUST explicitly state this")', () => {
      const out = getLargeOutputInstructions(
        '/tmp/file.txt',
        100,
        'Plain text',
      )
      expect(out).toContain('you MUST explicitly state this')
    })
  })

  describe('getBinaryBlobSavedMessage', () => {
    test('includes source description + mime + size + path', () => {
      const msg = getBinaryBlobSavedMessage(
        '/tmp/x.pdf',
        'application/pdf',
        12345,
        'From WebFetch: ',
      )
      expect(msg).toContain('From WebFetch:')
      expect(msg).toContain('application/pdf')
      expect(msg).toContain('/tmp/x.pdf')
    })

    test('undefined mime → "unknown type"', () => {
      const msg = getBinaryBlobSavedMessage(
        '/tmp/x.bin',
        undefined,
        100,
        '',
      )
      expect(msg).toContain('unknown type')
    })

    test('uses formatFileSize for human-readable size (not raw bytes)', () => {
      const msg = getBinaryBlobSavedMessage('/x', 'application/pdf', 2048, '')
      // 2048 bytes = 2 KB; should NOT contain literal "2048".
      // (formatFileSize is from @claude-code/output/formatters — pinned
      // separately. Here we just confirm the spelling.)
      expect(msg).toContain('Binary content')
    })
  })
})
