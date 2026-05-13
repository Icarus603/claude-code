/**
 * ShareOnboardingGuide — invariant tests against ant v2.1.136
 * (3949.js xL8 / 3950.js Ug7).
 *
 * Covers the tool-shape invariants: schema, name, descriptions, gate
 * predicates, render and result-mapper outputs. The network calls
 * (createOnboardingGuide / updateOnboardingGuide / etc.) are integration
 * and live in api fixture tests.
 */
import { describe, expect, test } from 'bun:test'
import { ShareOnboardingGuideTool } from '../ShareOnboardingGuideTool.js'
import {
  MAX_ONBOARDING_SIZE_BYTES,
  ONBOARDING_MD_FILENAME,
  SHARE_ONBOARDING_GUIDE_DESCRIPTION,
  SHARE_ONBOARDING_GUIDE_TOOL_NAME,
} from '../constants.js'

describe('constants (ant v2.1.136)', () => {
  test('tool name = "ShareOnboardingGuide" (ant TM_)', () => {
    expect(SHARE_ONBOARDING_GUIDE_TOOL_NAME).toBe('ShareOnboardingGuide')
  })
  test('filename = "ONBOARDING.md" (ant AM_)', () => {
    expect(ONBOARDING_MD_FILENAME).toBe('ONBOARDING.md')
  })
  test('size cap = 64KB = 65536 bytes (ant OA6)', () => {
    expect(MAX_ONBOARDING_SIZE_BYTES).toBe(65536)
  })
  test('description preserves the load-bearing "default mode=check" phrasing', () => {
    expect(SHARE_ONBOARDING_GUIDE_DESCRIPTION).toContain(
      `Upload the ${ONBOARDING_MD_FILENAME}`,
    )
    expect(SHARE_ONBOARDING_GUIDE_DESCRIPTION).toContain(
      "When called with the default mode='check'",
    )
    expect(SHARE_ONBOARDING_GUIDE_DESCRIPTION).toContain('status: has_existing')
  })
})

describe('tool surface (ant Il5)', () => {
  test('name matches constant', () => {
    expect(ShareOnboardingGuideTool.name).toBe(SHARE_ONBOARDING_GUIDE_TOOL_NAME)
  })
  test('isReadOnly: false', () => {
    expect(ShareOnboardingGuideTool.isReadOnly?.({} as never)).toBe(false)
  })
  test('isConcurrencySafe: false', () => {
    expect(ShareOnboardingGuideTool.isConcurrencySafe?.()).toBe(false)
  })
  test('isDestructive only on mode="delete"', () => {
    expect(
      ShareOnboardingGuideTool.isDestructive?.({ mode: 'delete' } as never),
    ).toBe(true)
    expect(
      ShareOnboardingGuideTool.isDestructive?.({ mode: 'check' } as never),
    ).toBe(false)
    expect(
      ShareOnboardingGuideTool.isDestructive?.({ mode: 'create' } as never),
    ).toBe(false)
    expect(
      ShareOnboardingGuideTool.isDestructive?.({ mode: 'update' } as never),
    ).toBe(false)
  })
  test('checkPermissions: behavior=allow (ant ships no checkPermissions)', async () => {
    const result = await ShareOnboardingGuideTool.checkPermissions?.(
      { mode: 'check' } as never,
      {} as never,
    )
    expect(result?.behavior).toBe('allow')
  })
  test('validateInput: { result: true }', async () => {
    const result = await ShareOnboardingGuideTool.validateInput?.(
      { mode: 'check' } as never,
      {} as never,
    )
    expect(result).toEqual({ result: true })
  })
  test('renderToolUseMessage: null for default mode, mode string for others', () => {
    expect(
      ShareOnboardingGuideTool.renderToolUseMessage?.(
        { mode: 'check' } as never,
        {} as never,
      ),
    ).toBeNull()
    expect(
      ShareOnboardingGuideTool.renderToolUseMessage?.(
        { mode: 'update' } as never,
        {} as never,
      ),
    ).toBe('update')
    expect(
      ShareOnboardingGuideTool.renderToolUseMessage?.(
        { mode: 'delete' } as never,
        {} as never,
      ),
    ).toBe('delete')
  })
})

describe('mapToolResultToToolResultBlockParam', () => {
  test('content format: "[status] message"', () => {
    const param = ShareOnboardingGuideTool.mapToolResultToToolResultBlockParam(
      {
        status: 'created',
        share_url: 'https://example/x',
        short_code: 'abc',
        message: 'Created abc',
      },
      'tu_1' as never,
    )
    expect(param.content).toBe('[created] Created abc')
    expect(param.tool_use_id).toBe('tu_1')
    expect(param.type).toBe('tool_result')
  })
  test('handles unavailable status', () => {
    const param = ShareOnboardingGuideTool.mapToolResultToToolResultBlockParam(
      { status: 'unavailable', message: 'no oauth' } as never,
      'tu_2' as never,
    )
    expect(param.content).toBe('[unavailable] no oauth')
  })
})

describe('toAutoClassifierInput', () => {
  test('default mode → "share onboarding guide (mode: check)"', () => {
    expect(
      ShareOnboardingGuideTool.toAutoClassifierInput?.({} as never),
    ).toBe('share onboarding guide (mode: check)')
  })
  test('explicit mode forwarded', () => {
    expect(
      ShareOnboardingGuideTool.toAutoClassifierInput?.({
        mode: 'delete',
      } as never),
    ).toBe('share onboarding guide (mode: delete)')
  })
})
