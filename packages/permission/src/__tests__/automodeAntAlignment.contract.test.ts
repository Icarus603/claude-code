import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level contract pins for the 2026-05-27 full alignment of ccb's
 * auto-mode classifier with ant v2.1.150. These four behaviours were silently
 * diverging and made auto mode "block too easily"; the pins keep a future edit
 * from regressing them. See
 * memory/project_automode_full_align_ant_2150_2026_05_27.md and ant source
 * bun-demincer/work/claude-code-2.1.150/resplit/{3149,4260}.js.
 *
 * Why source-level: bun:test runs with feature flags OFF (TRANSCRIPT_CLASSIFIER
 * gated) and the classifier path makes live sideQuery calls, so the assembled
 * prompt / decision flow can't be exercised at runtime here. We pin the SHAPE.
 */

const yoloClassifier = readFileSync(
  resolve(__dirname, '..', 'yoloClassifier.ts'),
  'utf-8',
)
const xmlFormat = readFileSync(
  resolve(__dirname, '..', 'classifierXmlFormat.ts'),
  'utf-8',
)
const permissions = readFileSync(
  resolve(__dirname, '..', 'permissions.ts'),
  'utf-8',
)
const classifierDecision = readFileSync(
  resolve(__dirname, '..', 'classifierDecision.ts'),
  'utf-8',
)

describe('auto-mode classifier model (ant IZ7→F7: main-loop, not Haiku)', () => {
  const fnStart = yoloClassifier.indexOf('function getClassifierModel')
  const fnSlice = yoloClassifier.slice(fnStart, fnStart + 2000)

  test('falls back to the main-loop model, matching ant', () => {
    expect(fnStart).toBeGreaterThan(0)
    expect(fnSlice).toMatch(/return getMainLoopModel\(\)/)
  })

  test('does NOT route the classifier to the small-fast model', () => {
    // The 508fee15 Haiku swap is reverted — a weak model under an
    // "err on the side of blocking" prompt over-blocks benign actions.
    expect(fnSlice).not.toMatch(/return getSmallFastModel\(\)/)
  })

  test('env override CLAUDE_CODE_AUTO_MODE_MODEL stays the escape hatch', () => {
    expect(yoloClassifier).toMatch(/CLAUDE_CODE_AUTO_MODE_MODEL/)
  })
})

describe('two-stage classifier stage-1 suffix (ant Gp5: both→fp5, fast→Mp5)', () => {
  test('fp5 (both-mode) suffix exists and defers intent/ALLOW to stage 2', () => {
    expect(xmlFormat).toMatch(/XML_S1_SUFFIX_BOTH/)
    expect(xmlFormat).toMatch(
      /Stage 1 does NOT apply user intent or ALLOW exceptions/,
    )
    expect(xmlFormat).toMatch(/Block if ANY rule could apply/)
  })

  test('Mp5 (fast-only) suffix stays the terse immediate-block form', () => {
    expect(xmlFormat).toMatch(
      /XML_S1_SUFFIX = '\\nErr on the side of blocking\. <block> immediately\.'/,
    )
  })

  test('classifier selects the suffix by mode (both vs fast)', () => {
    expect(yoloClassifier).toMatch(
      /mode === 'both' \? XML_S1_SUFFIX_BOTH : XML_S1_SUFFIX/,
    )
  })
})

describe('CLAUDE.md classifier message (ant Ap5 scoping)', () => {
  test('scopes authorization to the SPECIFIC action, same operation/target', () => {
    expect(yoloClassifier).toMatch(/authorizes the SPECIFIC action under review/)
    expect(yoloClassifier).toMatch(/same operation, same/)
  })

  test('denies that generic encouragement lowers the block threshold', () => {
    expect(yoloClassifier).toMatch(/Generic/)
    expect(yoloClassifier).toMatch(/must not lower your block threshold/)
  })
})

describe('fallback-to-ask paths (ant xaH) — prompt, do not run the classifier', () => {
  test('isAskRuleDecision (ant FW6) recurses into subcommandResults', () => {
    expect(classifierDecision).toMatch(/export function isAskRuleDecision/)
    expect(classifierDecision).toMatch(/reason\?\.type === 'subcommandResults'/)
  })

  test('isPlanModeDecision (ant qMK) recognizes the plan-mode floor', () => {
    expect(classifierDecision).toMatch(/export function isPlanModeDecision/)
    expect(classifierDecision).toMatch(/reason\?\.type === 'mode'/)
  })

  test('the gate triages via computeAutoModeFallback before the classifier', () => {
    expect(permissions).toMatch(/computeAutoModeFallback\(/)
    expect(permissions).toMatch(/fallback === 'deny-headless'/)
  })

  test('sandboxOverride ALONE falls through to the classifier (ant: no J in j||D||f)', () => {
    // computeAutoModeFallback returns null for sandboxOverride-only so it
    // reaches the classifier; the three prompt-worthy reasons return a reason.
    expect(classifierDecision).toMatch(/sandboxOverride alone/)
    expect(classifierDecision).toMatch(/isSandboxOverride/)
    expect(classifierDecision).toMatch(
      /return \{ reason: 'safety_check' \}|reason: 'safety_check'/,
    )
  })

  test('emits tengu_auto_mode_fallback_to_ask for every fallback reason', () => {
    expect(permissions).toMatch(/tengu_auto_mode_fallback_to_ask/)
    // The triage reasons live in computeAutoModeFallback (classifierDecision);
    // the gate-level fallbacks (interaction/too-long/fail-open) live inline.
    for (const reason of ['safety_check', 'ask_rule', 'plan_mode_floor']) {
      expect(classifierDecision).toContain(`'${reason}'`)
    }
    for (const reason of [
      'requires_user_interaction',
      'transcript_too_long',
      'classifier_unavailable_fail_open',
    ]) {
      expect(permissions).toContain(`'${reason}'`)
    }
  })

  test('REPL is allowed through on transcript-too-long (ant if(H.name===e9))', () => {
    expect(permissions).toMatch(/tool\.name === REPL_TOOL_NAME/)
  })
})
