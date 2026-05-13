import { describe, expect, test } from 'bun:test'

import {
  FIRST_PRESS_FALLBACK_MS,
  computeLevel,
  normalizeLanguageForSTT,
} from '../useVoice.ts'

/**
 * Pin voice mode helpers — audio amplitude calc and STT language
 * normalization. Wrong values affect the recording UX directly:
 *   - computeLevel: wrong → waveform visualizer flatlines or saturates
 *   - normalizeLanguageForSTT: wrong → STT requests sent with garbage
 *     language code, transcription falls back to English silently
 */
describe('useVoice helpers (voice-mode UX invariants)', () => {
  describe('computeLevel (RMS amplitude → 0..1 with sqrt curve)', () => {
    test('empty buffer → 0 (no crash)', () => {
      expect(computeLevel(Buffer.alloc(0))).toBe(0)
    })

    test('all-zero PCM → 0 (silent)', () => {
      const buf = Buffer.alloc(64)
      expect(computeLevel(buf)).toBe(0)
    })

    test('positive 16-bit samples produce non-zero level', () => {
      // 16 samples × 32 bytes? Each sample is 2 bytes.
      // Fill with value 5000 (well below max 32767)
      const buf = Buffer.alloc(64)
      for (let i = 0; i < 32; i++) {
        buf.writeInt16LE(5000, i * 2)
      }
      const level = computeLevel(buf)
      expect(level).toBeGreaterThan(0)
      expect(level).toBeLessThanOrEqual(1)
    })

    test('full-amplitude signal saturates near 1', () => {
      // Max 16-bit signed = 32767. RMS of pure 32767 = 32767.
      // normalized = min(32767/2000, 1) = 1; sqrt(1) = 1.
      const buf = Buffer.alloc(64)
      for (let i = 0; i < 32; i++) {
        buf.writeInt16LE(32767, i * 2)
      }
      expect(computeLevel(buf)).toBe(1)
    })

    test('handles negative samples (16-bit signed sign extension)', () => {
      // Samples at -16000 should produce same level as +16000 (squared).
      const buf = Buffer.alloc(64)
      for (let i = 0; i < 32; i++) {
        buf.writeInt16LE(-16000, i * 2)
      }
      const negLevel = computeLevel(buf)

      const posBuf = Buffer.alloc(64)
      for (let i = 0; i < 32; i++) {
        posBuf.writeInt16LE(16000, i * 2)
      }
      const posLevel = computeLevel(posBuf)

      expect(negLevel).toBeCloseTo(posLevel, 5)
    })

    test('returns 0..1 range (never NaN, never > 1)', () => {
      // Test a variety of inputs — random buffer
      for (let trial = 0; trial < 10; trial++) {
        const buf = Buffer.alloc(64)
        for (let i = 0; i < 32; i++) {
          buf.writeInt16LE(Math.floor((Math.random() - 0.5) * 60000), i * 2)
        }
        const level = computeLevel(buf)
        expect(level).toBeGreaterThanOrEqual(0)
        expect(level).toBeLessThanOrEqual(1)
        expect(Number.isNaN(level)).toBe(false)
      }
    })
  })

  describe('normalizeLanguageForSTT (BCP-47-ish → STT-supported)', () => {
    test('undefined/empty → default STT language (no fellBackFrom)', () => {
      expect(normalizeLanguageForSTT(undefined).code).toBeTruthy()
      expect(normalizeLanguageForSTT('').code).toBeTruthy()
      // Empty/undefined are "no preference", not a fallback
      expect(normalizeLanguageForSTT(undefined).fellBackFrom).toBeUndefined()
    })

    test('supported lowercase code passes through', () => {
      const result = normalizeLanguageForSTT('en')
      expect(result.code).toBe('en')
      expect(result.fellBackFrom).toBeUndefined()
    })

    test('mixed-case code lowercased ("EN" → "en")', () => {
      const result = normalizeLanguageForSTT('EN')
      expect(result.code).toBe('en')
    })

    test('whitespace trimmed (" en " → "en")', () => {
      const result = normalizeLanguageForSTT(' en ')
      expect(result.code).toBe('en')
    })

    test('region-variant falls back to base ("en-US" → "en")', () => {
      const result = normalizeLanguageForSTT('en-US')
      expect(result.code).toBe('en')
    })

    test('unknown language → default WITH fellBackFrom recording original', () => {
      const result = normalizeLanguageForSTT('klingon')
      expect(result.fellBackFrom).toBe('klingon')
      // code falls back to whatever DEFAULT_STT_LANGUAGE is
      expect(result.code).toBeTruthy()
    })
  })

  describe('timing constants', () => {
    test('FIRST_PRESS_FALLBACK_MS = 2000 (covers macOS "Long" key repeat delay)', () => {
      // macOS key repeat slider at "Long" can have initial delay ~2s.
      // Setting this too short → recording stops before user's auto-repeat
      // arrives → tap-and-release loses the recording.
      expect(FIRST_PRESS_FALLBACK_MS).toBe(2000)
    })
  })
})
