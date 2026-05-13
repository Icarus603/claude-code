import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pins for `internal/logging.ts`. These are catch-block / hot
 * path observers that delegate to the host bindings — with a console.* fall
 * back so that errors are NEVER swallowed when no host is installed.
 *
 * Three invariants:
 *  1. logEvent: pure delegate (telemetry) — silent no-op if host is missing.
 *  2. logError + logAntError: delegate if installed, ELSE console.error fall
 *     back. Never silent.
 *  3. logForDebugging: pure delegate (debug log file) — silent no-op if host
 *     is missing.
 *
 * The delegate-vs-fallback split matters: telemetry/debug-log going dark is
 * acceptable; errors going dark is not.
 */
describe('internal/logging', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'internal', 'logging.ts'),
    'utf-8',
  )

  describe('logEvent (telemetry — silent fallback OK)', () => {
    test('delegates via optional chain (no host = no-op)', () => {
      expect(source).toMatch(
        /logEvent\([\s\S]{0,300}?getAgentHostBindings\(\)\.logEvent\?\.\(/,
      )
    })

    test('NOT silent-fallback: no console.* in logEvent', () => {
      // Pin: telemetry SHOULD be silent when the analytics sink is missing.
      // A future refactor that "let's always console.log telemetry" would
      // spam stderr.
      const block = source.match(
        /export function logEvent\([\s\S]+?\n\}/,
      )?.[0]
      expect(block).toBeTruthy()
      expect(block).not.toMatch(/console\./)
    })
  })

  describe('logError (error — console.error fallback REQUIRED)', () => {
    test('uses console.error when host binding is missing', () => {
      expect(source).toMatch(
        /logError[\s\S]{0,300}?if \(logger\) \{[\s\S]{0,200}?logger\(error\)[\s\S]{0,100}?\}\s*\n\s*console\.error\(error\)/,
      )
    })

    test('falls through (early-return after host call, no double log)', () => {
      // Pin: if host binding fires, we RETURN — never double-log.
      // A regression that drops the `return` would log every error twice.
      const block = source.match(
        /export function logError\([\s\S]+?\n\}/,
      )?.[0]
      expect(block).toMatch(/logger\(error\)\s*\n\s*return/)
    })
  })

  describe('logAntError (named error — same fallback discipline)', () => {
    test('passes BOTH message and error to logger and console', () => {
      // Pin: signature is (message, error). A regression that drops the
      // message field would lose the human-readable label in logs.
      expect(source).toMatch(
        /logAntError\(message: string, error: unknown\)/,
      )
      expect(source).toMatch(/logger\(message, error\)/)
      expect(source).toMatch(/console\.error\(message, error\)/)
    })

    test('early-returns on host hit (no double log)', () => {
      const block = source.match(
        /export function logAntError\([\s\S]+?\n\}/,
      )?.[0]
      expect(block).toMatch(/logger\(message, error\)\s*\n\s*return/)
    })
  })

  describe('logForDebugging (debug log file — silent fallback OK)', () => {
    test('delegates via optional chain (no console fallback)', () => {
      expect(source).toMatch(
        /logForDebugging\([\s\S]{0,300}?getAgentHostBindings\(\)\.logDebug\?\.\(message, metadata\)/,
      )
    })

    test('NO console.* fallback (debug-only is silent when sink absent)', () => {
      const block = source.match(
        /export function logForDebugging\([\s\S]+?\n\}/,
      )?.[0]
      expect(block).toBeTruthy()
      expect(block).not.toMatch(/console\./)
    })

    test('accepts optional metadata', () => {
      expect(source).toMatch(/metadata\?:\s*unknown/)
    })
  })

  test('AnalyticsMetadata type is re-exported for callers', () => {
    // Callers pass typed metadata; re-export keeps them from reaching
    // through internalTypes directly.
    expect(source).toMatch(
      /export type \{ AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS \}/,
    )
  })
})
