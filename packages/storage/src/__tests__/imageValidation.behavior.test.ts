import { describe, expect, test } from 'bun:test'

import {
  ImageSizeError,
  validateImagesForAPI,
} from '../imageValidation.ts'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// API_IMAGE_MAX_BASE64_SIZE = 5 MB (pinned in apiLimits.behavior.test.ts).
// Inlined here to avoid a cross-package import resolution issue under bun:test.
const API_IMAGE_MAX_BASE64_SIZE = 5 * 1024 * 1024

/**
 * Pin `imageValidation.ts` — API-boundary safety net for oversized images.
 *
 * Critical invariants:
 *  1. Validation checks BASE64-encoded length, NOT decoded byte count.
 *     A regression that decodes first would waste cycles AND change the
 *     limit interpretation.
 *  2. Only USER messages are checked (assistant messages get image
 *     content too, but those came from the model — not user-controlled).
 *  3. Inner message shape: { type: 'user', message: { role, content } }.
 *  4. Content must be an array; string content skipped.
 *  5. Image blocks must be base64 form: { type: 'image', source: {
 *     type: 'base64', data: string } }. URL form is skipped.
 *  6. Errors collected across the message batch, single throw at end.
 *  7. ImageSizeError message format:
 *     - 1 image: "Image base64 size (...) exceeds API limit (...)"
 *     - N images: "N images exceed the API limit (...): Image 1: ..., Image 2: ..."
 *  8. Telemetry tengu_image_api_validation_failed per oversized image.
 */
describe('validateImagesForAPI', () => {
  test('empty messages → no throw', () => {
    expect(() => validateImagesForAPI([])).not.toThrow()
  })

  test('non-array messages tolerated (just skipped)', () => {
    expect(() =>
      validateImagesForAPI([null, undefined, 'string', 42]),
    ).not.toThrow()
  })

  test('user msg without image content → no throw', () => {
    expect(() =>
      validateImagesForAPI([
        {
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        },
      ]),
    ).not.toThrow()
  })

  test('user msg with small image (under limit) → no throw', () => {
    // Pin: under-limit base64 string passes through.
    const smallBase64 = 'A'.repeat(1000)
    expect(() =>
      validateImagesForAPI([
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', data: smallBase64 },
              },
            ],
          },
        },
      ]),
    ).not.toThrow()
  })

  test('user msg with oversized image (> 5MB base64) → throws ImageSizeError', () => {
    // Pin: API_IMAGE_MAX_BASE64_SIZE is the wire-protocol limit.
    const oversizedBase64 = 'A'.repeat(API_IMAGE_MAX_BASE64_SIZE + 1000)
    expect(() =>
      validateImagesForAPI([
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', data: oversizedBase64 },
              },
            ],
          },
        },
      ]),
    ).toThrow(ImageSizeError)
  })

  test('assistant message images are NOT validated', () => {
    // Pin: only `type: 'user'` messages are scanned. Assistant images
    // (e.g., from prior turns) aren't subject to upload limits.
    const oversizedBase64 = 'A'.repeat(API_IMAGE_MAX_BASE64_SIZE + 1000)
    expect(() =>
      validateImagesForAPI([
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'image',
                source: { type: 'base64', data: oversizedBase64 },
              },
            ],
          },
        },
      ]),
    ).not.toThrow()
  })

  test('string content is skipped (not an array)', () => {
    expect(() =>
      validateImagesForAPI([
        {
          type: 'user',
          message: { role: 'user', content: 'just a string' },
        },
      ]),
    ).not.toThrow()
  })

  test('image with URL source (not base64) is skipped', () => {
    // Pin: type guard requires source.type === 'base64'. URL-form
    // images aren't subject to the base64-size limit.
    expect(() =>
      validateImagesForAPI([
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'url',
                  url: 'https://example.com/huge.png',
                },
              },
            ],
          },
        },
      ]),
    ).not.toThrow()
  })

  test('mixed: small + oversized → throws with oversized info only', () => {
    // Pin: single throw at end; collects all oversized.
    const small = 'A'.repeat(100)
    const oversized = 'A'.repeat(API_IMAGE_MAX_BASE64_SIZE + 1)
    try {
      validateImagesForAPI([
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', data: small } },
              { type: 'image', source: { type: 'base64', data: oversized } },
            ],
          },
        },
      ])
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ImageSizeError)
    }
  })

  test('multiple oversized images: error mentions count', () => {
    const oversized = 'A'.repeat(API_IMAGE_MAX_BASE64_SIZE + 1)
    try {
      validateImagesForAPI([
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', data: oversized } },
              { type: 'image', source: { type: 'base64', data: oversized } },
            ],
          },
        },
      ])
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('2 images exceed')
    }
  })
})

describe('ImageSizeError', () => {
  test('single image error format', () => {
    const err = new ImageSizeError([{ index: 1, size: 6_000_000 }], 5_242_880)
    expect(err.message).toContain('exceeds API limit')
    expect(err.message).toContain('Please resize the image')
    // Pin: singular wording for one image.
    expect(err.message).not.toContain('images exceed')
  })

  test('multi-image error format with comma-separated list', () => {
    const err = new ImageSizeError(
      [
        { index: 1, size: 6_000_000 },
        { index: 3, size: 7_000_000 },
      ],
      5_242_880,
    )
    expect(err.message).toContain('2 images exceed')
    expect(err.message).toContain('Image 1:')
    expect(err.message).toContain('Image 3:')
    // Pin: comma separates entries.
    expect(err.message).toContain(', ')
  })

  test('name === "ImageSizeError"', () => {
    // Pin: catch handlers check name for specific recovery paths.
    const err = new ImageSizeError([{ index: 1, size: 1 }], 1)
    expect(err.name).toBe('ImageSizeError')
  })

  test('extends Error', () => {
    const err = new ImageSizeError([{ index: 1, size: 1 }], 1)
    expect(err instanceof Error).toBe(true)
  })
})

describe('imageValidation — source pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'imageValidation.ts'),
    'utf-8',
  )

  test('Validates base64.length (NOT decoded byte length)', () => {
    // Pin: critical perf + semantic invariant.
    expect(source).toMatch(/const base64Size = block\.source\.data\.length/)
  })

  test('Only user messages scanned (assistant skipped)', () => {
    expect(source).toMatch(/if \(m\.type !== 'user'\) continue/)
  })

  test('Telemetry tengu_image_api_validation_failed per oversized image', () => {
    // Pin: the dashboard query joins on this exact name.
    expect(source).toMatch(/'tengu_image_api_validation_failed'/)
    // Per-image (inside the loop, not once at the end).
    expect(source).toMatch(
      /logEvent\('tengu_image_api_validation_failed'[\s\S]+?oversizedImages\.push/,
    )
  })

  test('Single throw at end of validation pass (collected errors)', () => {
    expect(source).toMatch(
      /if \(oversizedImages\.length > 0\) \{\s*\n?\s*throw new ImageSizeError\(oversizedImages, API_IMAGE_MAX_BASE64_SIZE\)/,
    )
  })

  test('Uses API_IMAGE_MAX_BASE64_SIZE constant (NOT hardcoded literal)', () => {
    // Pin: the limit comes from provider/apiLimits; hardcoding here
    // would drift if the provider value updates.
    expect(source).toMatch(/API_IMAGE_MAX_BASE64_SIZE/)
    // No 5_242_880 / 5242880 hardcoded number.
    expect(source).not.toMatch(/5_?242_?880/)
  })
})
