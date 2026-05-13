import { describe, expect, test } from 'bun:test'

import {
  API_IMAGE_MAX_BASE64_SIZE,
  API_MAX_MEDIA_PER_REQUEST,
  API_PDF_MAX_PAGES,
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_TARGET_RAW_SIZE,
  PDF_AT_MENTION_INLINE_THRESHOLD,
  PDF_EXTRACT_SIZE_THRESHOLD,
  PDF_MAX_EXTRACT_SIZE,
  PDF_MAX_PAGES_PER_READ,
  PDF_TARGET_RAW_SIZE,
} from '../apiLimits.ts'

/**
 * Pin Anthropic API limit constants. These are server-enforced limits;
 * client-side caps must match exactly. Wrong values silently break:
 *   - Image too small client cap (user gets "image too large" 400 from
 *     API instead of nice REPL message)
 *   - PDF max pages off → user can attach 100-page PDF but API rejects
 *   - Inline-vs-attachment threshold wrong → big PDFs blow up @-mention turn
 */
describe('API limit constants (server-coordinated)', () => {
  describe('image limits', () => {
    test('API_IMAGE_MAX_BASE64_SIZE = 5 MB (server-enforced)', () => {
      expect(API_IMAGE_MAX_BASE64_SIZE).toBe(5 * 1024 * 1024)
    })

    test('IMAGE_TARGET_RAW_SIZE = 3.75 MB (base64 = 4/3 × raw, so raw cap is 3.75 MB)', () => {
      expect(IMAGE_TARGET_RAW_SIZE).toBe((API_IMAGE_MAX_BASE64_SIZE * 3) / 4)
      expect(IMAGE_TARGET_RAW_SIZE).toBe(3.75 * 1024 * 1024)
    })

    test('IMAGE_MAX_WIDTH = 2000 (Anthropic resize-or-reject threshold)', () => {
      expect(IMAGE_MAX_WIDTH).toBe(2000)
    })

    test('IMAGE_MAX_HEIGHT = 2000 (same threshold for height)', () => {
      expect(IMAGE_MAX_HEIGHT).toBe(2000)
    })
  })

  describe('PDF limits', () => {
    test('PDF_TARGET_RAW_SIZE = 20 MB (server-enforced per-PDF cap)', () => {
      expect(PDF_TARGET_RAW_SIZE).toBe(20 * 1024 * 1024)
    })

    test('API_PDF_MAX_PAGES = 100 (server-enforced page limit per PDF)', () => {
      expect(API_PDF_MAX_PAGES).toBe(100)
    })

    test('PDF_EXTRACT_SIZE_THRESHOLD = 3 MB (large-pdf-extracts threshold)', () => {
      // Below 3MB → inline as direct API attachment; above → extract text
      // first via PDF parser to avoid blowing the request budget.
      expect(PDF_EXTRACT_SIZE_THRESHOLD).toBe(3 * 1024 * 1024)
    })

    test('PDF_MAX_EXTRACT_SIZE = 100 MB (upper bound for extraction path)', () => {
      // Beyond 100MB even text-extraction is too big — refuse entirely.
      expect(PDF_MAX_EXTRACT_SIZE).toBe(100 * 1024 * 1024)
    })

    test('PDF_MAX_PAGES_PER_READ = 20 (Read tool per-request cap)', () => {
      // Users must paginate to read 100-page PDFs (5 reads × 20 pages).
      // Caps per-request token cost.
      expect(PDF_MAX_PAGES_PER_READ).toBe(20)
    })

    test('PDF_AT_MENTION_INLINE_THRESHOLD = 10 (small PDFs inline on @ mention)', () => {
      // PDFs ≤10 pages inline in @ mention; bigger ones get summarized
      // before injection to keep the turn manageable.
      expect(PDF_AT_MENTION_INLINE_THRESHOLD).toBe(10)
    })
  })

  describe('per-request media count', () => {
    test('API_MAX_MEDIA_PER_REQUEST = 100', () => {
      // Hard server cap. Pin so client-side bundling doesn't over-pack.
      expect(API_MAX_MEDIA_PER_REQUEST).toBe(100)
    })
  })

  describe('invariants across limits', () => {
    test('image-base64-cap and raw-target are consistent (4/3 ratio)', () => {
      // base64 inflates raw bytes by 4/3 → raw target = base64 cap × 3/4.
      // If base64 ever changes, raw target must update in lockstep.
      const expectedRaw = (API_IMAGE_MAX_BASE64_SIZE * 3) / 4
      expect(IMAGE_TARGET_RAW_SIZE).toBe(expectedRaw)
    })

    test('PDF extract threshold < target raw size (small pdfs inline, big extracted)', () => {
      // PDF_EXTRACT_SIZE_THRESHOLD is the "go extract text" point.
      // PDF_TARGET_RAW_SIZE is the "max binary attachment size".
      // Threshold must be < target so there's a range where we attach as binary.
      expect(PDF_EXTRACT_SIZE_THRESHOLD).toBeLessThan(PDF_TARGET_RAW_SIZE)
    })

    test('PDF_TARGET_RAW_SIZE < PDF_MAX_EXTRACT_SIZE (extract path covers bigger files)', () => {
      // Binary attachment caps at 20MB; text-extraction caps at 100MB.
      expect(PDF_TARGET_RAW_SIZE).toBeLessThan(PDF_MAX_EXTRACT_SIZE)
    })

    test('PDF_MAX_PAGES_PER_READ < API_PDF_MAX_PAGES (per-read smaller than per-doc)', () => {
      expect(PDF_MAX_PAGES_PER_READ).toBeLessThan(API_PDF_MAX_PAGES)
    })
  })
})
