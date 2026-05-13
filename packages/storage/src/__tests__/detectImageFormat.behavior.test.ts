import { describe, expect, test } from 'bun:test'

import {
  detectImageFormatFromBase64,
  detectImageFormatFromBuffer,
} from '../imageResizer.ts'

/**
 * Pin image format detection via magic bytes. Used by the FileReadTool
 * and image-paste handling — wrong format passed to the API → server
 * rejects the request (content-type mismatch).
 */
describe('image format detection (magic-byte sniffing)', () => {
  describe('detectImageFormatFromBuffer', () => {
    test('PNG signature (89 50 4E 47) → image/png', () => {
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      expect(detectImageFormatFromBuffer(buf)).toBe('image/png')
    })

    test('JPEG signature (FF D8 FF) → image/jpeg', () => {
      const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
      expect(detectImageFormatFromBuffer(buf)).toBe('image/jpeg')
    })

    test('GIF signature (47 49 46) → image/gif', () => {
      // "GIF89a"
      const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
      expect(detectImageFormatFromBuffer(buf)).toBe('image/gif')
    })

    test('WebP signature (RIFF....WEBP) → image/webp', () => {
      // "RIFF" + 4 size bytes + "WEBP"
      const buf = Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from('WEBP'),
      ])
      expect(detectImageFormatFromBuffer(buf)).toBe('image/webp')
    })

    test('RIFF but NOT WebP → default image/png (defensive)', () => {
      // "RIFF" + size + "WAVE" (audio) — must NOT detect as image/webp.
      const buf = Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from('WAVE'),
      ])
      expect(detectImageFormatFromBuffer(buf)).toBe('image/png')
    })

    test('Short buffer (< 4 bytes) → default image/png (defensive)', () => {
      expect(detectImageFormatFromBuffer(Buffer.from([0x89]))).toBe('image/png')
      expect(detectImageFormatFromBuffer(Buffer.from([]))).toBe('image/png')
    })

    test('Unknown magic bytes → default image/png', () => {
      // Defensive: random bytes shouldn't crash; PNG is the most permissive
      // server-side fallback.
      const buf = Buffer.from([0xab, 0xcd, 0xef, 0x12])
      expect(detectImageFormatFromBuffer(buf)).toBe('image/png')
    })
  })

  describe('detectImageFormatFromBase64', () => {
    test('PNG base64 → image/png', () => {
      // PNG header in base64
      const pngBase64 = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      ]).toString('base64')
      expect(detectImageFormatFromBase64(pngBase64)).toBe('image/png')
    })

    test('JPEG base64 → image/jpeg', () => {
      const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64')
      expect(detectImageFormatFromBase64(jpegBase64)).toBe('image/jpeg')
    })

    test('invalid base64 or unknown → default image/png', () => {
      // Garbage input doesn't crash; falls to PNG default.
      const result = detectImageFormatFromBase64('not-actually-base64')
      expect(result).toBeTruthy()
      // Either 'image/png' or detected from the partial decode
      expect(['image/png', 'image/jpeg', 'image/gif', 'image/webp']).toContain(result)
    })
  })
})
