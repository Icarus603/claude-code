/**
 * Tests for imageResizer.ts pure helpers — exercised on every dropped /
 * pasted image.
 *
 * Wrong magic-byte detection means an uploaded JPEG gets sent as
 * `image/png` to the API and the model sees garbled bytes. These probes
 * lock the magic-byte signatures + edge cases (truncated buffers, non-
 * image data) so a refactor can't silently drop a format.
 */
import { describe, expect, test } from 'bun:test'
import {
  createImageMetadataText,
  detectImageFormatFromBase64,
  detectImageFormatFromBuffer,
} from '../imageResizer.js'

// PNG magic: 89 50 4E 47 0D 0A 1A 0A
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// JPEG magic: FF D8 FF
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
// GIF magic: GIF8(7|9)a (47 49 46 38 ...)
const GIF87A_HEADER = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
const GIF89A_HEADER = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
// WebP magic: RIFF....WEBP
const WEBP_HEADER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
])

describe('detectImageFormatFromBuffer — magic bytes', () => {
  test('PNG signature → image/png', () => {
    expect(detectImageFormatFromBuffer(PNG_HEADER)).toBe('image/png')
  })

  test('JPEG signature → image/jpeg', () => {
    expect(detectImageFormatFromBuffer(JPEG_HEADER)).toBe('image/jpeg')
  })

  test('GIF87a signature → image/gif', () => {
    expect(detectImageFormatFromBuffer(GIF87A_HEADER)).toBe('image/gif')
  })

  test('GIF89a signature → image/gif', () => {
    expect(detectImageFormatFromBuffer(GIF89A_HEADER)).toBe('image/gif')
  })

  test('WebP RIFF+WEBP signature → image/webp', () => {
    expect(detectImageFormatFromBuffer(WEBP_HEADER)).toBe('image/webp')
  })
})

describe('detectImageFormatFromBuffer — edge cases', () => {
  test('empty buffer → image/png (default)', () => {
    expect(detectImageFormatFromBuffer(Buffer.from([]))).toBe('image/png')
  })

  test('< 4 bytes returns image/png default', () => {
    // Documented behavior: buffer.length < 4 short-circuits to 'image/png'
    // before any signature check runs.
    expect(detectImageFormatFromBuffer(Buffer.from([0xff, 0xd8, 0xff]))).toBe(
      'image/png',
    )
  })

  test('unknown magic bytes → image/png (default)', () => {
    const unknown = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])
    expect(detectImageFormatFromBuffer(unknown)).toBe('image/png')
  })

  test('RIFF header WITHOUT WEBP at offset 8 → image/png', () => {
    // RIFF header alone isn't enough — must have WEBP at byte 8.
    // RIFF is also used for WAV, AVI, etc. Without the WEBP marker,
    // fall through to default png.
    const riffWav = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ])
    expect(detectImageFormatFromBuffer(riffWav)).toBe('image/png')
  })

  test('RIFF header but truncated < 12 bytes → image/png', () => {
    // Boundary: function checks `buffer.length >= 12` before reading WEBP.
    const truncatedRiff = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
    ])
    expect(detectImageFormatFromBuffer(truncatedRiff)).toBe('image/png')
  })

  test('PNG signature in larger buffer is still detected', () => {
    const big = Buffer.concat([PNG_HEADER, Buffer.alloc(1024)])
    expect(detectImageFormatFromBuffer(big)).toBe('image/png')
  })

  test('JPEG signature with FFE0 (JFIF) marker detected', () => {
    // JPEG signatures vary at byte 3 (FFE0 = JFIF, FFE1 = EXIF, etc.).
    // The function only checks bytes 0-2 (FF D8 FF), so any 4th byte
    // works.
    expect(detectImageFormatFromBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xdb])))
      .toBe('image/jpeg')
  })
})

describe('detectImageFormatFromBase64', () => {
  test('valid PNG base64 → image/png', () => {
    expect(
      detectImageFormatFromBase64(PNG_HEADER.toString('base64')),
    ).toBe('image/png')
  })

  test('valid JPEG base64 → image/jpeg', () => {
    expect(
      detectImageFormatFromBase64(JPEG_HEADER.toString('base64')),
    ).toBe('image/jpeg')
  })

  test('empty string → image/png (Buffer.from("") yields zero-length)', () => {
    expect(detectImageFormatFromBase64('')).toBe('image/png')
  })

  test('garbage non-base64 still returns image/png (no throw)', () => {
    // Buffer.from with invalid base64 doesn't throw — it returns a buffer
    // of best-effort bytes. The function's try/catch is defense-in-depth.
    expect(detectImageFormatFromBase64('!!@#$%^&*()')).toBe('image/png')
  })
})

describe('createImageMetadataText — invalid dimensions', () => {
  test('zero originalWidth + no sourcePath → null', () => {
    expect(
      createImageMetadataText({
        originalWidth: 0,
        originalHeight: 100,
        displayWidth: 100,
        displayHeight: 100,
      }),
    ).toBeNull()
  })

  test('zero displayWidth + no sourcePath → null', () => {
    expect(
      createImageMetadataText({
        originalWidth: 100,
        originalHeight: 100,
        displayWidth: 0,
        displayHeight: 100,
      }),
    ).toBeNull()
  })

  test('negative displayWidth + no sourcePath → null', () => {
    // displayWidth <= 0 specifically — guards division by zero downstream.
    expect(
      createImageMetadataText({
        originalWidth: 100,
        originalHeight: 100,
        displayWidth: -10,
        displayHeight: 100,
      }),
    ).toBeNull()
  })

  test('all valid but no resize + no sourcePath → null', () => {
    // Same dimensions and no source = nothing useful to say.
    expect(
      createImageMetadataText({
        originalWidth: 100,
        originalHeight: 100,
        displayWidth: 100,
        displayHeight: 100,
      }),
    ).toBeNull()
  })

  test('invalid dims WITH sourcePath returns source-only line', () => {
    expect(
      createImageMetadataText(
        {
          originalWidth: 0,
          originalHeight: 0,
          displayWidth: 0,
          displayHeight: 0,
        },
        '/tmp/img.png',
      ),
    ).toBe('[Image source: /tmp/img.png]')
  })
})

describe('createImageMetadataText — resize math', () => {
  test('exact-half resize produces 2.00 scale factor', () => {
    expect(
      createImageMetadataText({
        originalWidth: 800,
        originalHeight: 600,
        displayWidth: 400,
        displayHeight: 300,
      }),
    ).toBe(
      '[Image: original 800x600, displayed at 400x300. Multiply coordinates by 2.00 to map to original image.]',
    )
  })

  test('non-integer scale factor formatted to 2 decimals', () => {
    // 1024 / 750 = 1.36533… → "1.37"
    const text = createImageMetadataText({
      originalWidth: 1024,
      originalHeight: 768,
      displayWidth: 750,
      displayHeight: 562,
    })
    expect(text).toContain('Multiply coordinates by 1.37')
  })

  test('source + resize combines both clauses', () => {
    const text = createImageMetadataText(
      {
        originalWidth: 800,
        originalHeight: 600,
        displayWidth: 400,
        displayHeight: 300,
      },
      '/path/img.png',
    )
    expect(text).toContain('source: /path/img.png')
    expect(text).toContain('original 800x600, displayed at 400x300')
  })

  test('source + no-resize emits source-only', () => {
    expect(
      createImageMetadataText(
        {
          originalWidth: 100,
          originalHeight: 100,
          displayWidth: 100,
          displayHeight: 100,
        },
        '/path/img.png',
      ),
    ).toBe('[Image: source: /path/img.png]')
  })

  test('asymmetric resize (different aspect) uses originalWidth/displayWidth ratio', () => {
    // Even when height ratio differs, the documented formula uses
    // originalWidth / displayWidth as the canonical scale factor.
    const text = createImageMetadataText({
      originalWidth: 1000,
      originalHeight: 1000,
      displayWidth: 500,
      displayHeight: 250,
    })
    expect(text).toContain('Multiply coordinates by 2.00')
  })
})
