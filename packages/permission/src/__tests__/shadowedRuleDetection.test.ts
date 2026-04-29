/**
 * Tests for shadowedRuleDetection — drives /doctor warnings about
 * unreachable permission rules in user/project/policy settings.
 *
 * Wrong shadow detection = either spurious warnings (annoying, training
 * users to ignore /doctor) OR missed shadows (real config bugs ship to
 * users — they THINK their allow rule lets them through, but the ask
 * rule above blocks every attempt).
 *
 * The Bash sandbox-auto-allow exception is especially subtle: tool-wide
 * ask rules from PERSONAL settings shouldn't shadow specific allow
 * rules when sandbox is enabled, but tool-wide ask rules from SHARED
 * settings (project/policy) MUST still warn — other team members may
 * not have sandbox.
 */
import { describe, expect, test } from 'bun:test'
import {
  detectUnreachableRules,
  isSharedSettingSource,
} from '../shadowedRuleDetection.js'
import type { ToolPermissionContext } from '@claude-code/tool-registry/Tool.js'
import type { PermissionRuleSource } from '../PermissionRule.js'

describe('isSharedSettingSource', () => {
  test('projectSettings is shared (committed to git)', () => {
    expect(isSharedSettingSource('projectSettings')).toBe(true)
  })

  test('policySettings is shared (enterprise-managed)', () => {
    expect(isSharedSettingSource('policySettings')).toBe(true)
  })

  test('command is shared (slash command frontmatter)', () => {
    expect(isSharedSettingSource('command')).toBe(true)
  })

  test('userSettings is personal', () => {
    expect(isSharedSettingSource('userSettings')).toBe(false)
  })

  test('localSettings is personal (gitignored)', () => {
    expect(isSharedSettingSource('localSettings')).toBe(false)
  })

  test('cliArg is personal (runtime)', () => {
    expect(isSharedSettingSource('cliArg')).toBe(false)
  })

  test('session is personal (in-memory)', () => {
    expect(isSharedSettingSource('session')).toBe(false)
  })

  test('flagSettings is personal (--settings flag)', () => {
    expect(isSharedSettingSource('flagSettings')).toBe(false)
  })

  test('unknown source falls through to false', () => {
    expect(
      isSharedSettingSource('unknownFutureSource' as PermissionRuleSource),
    ).toBe(false)
  })
})

const buildContext = (overrides: {
  allow?: Partial<Record<PermissionRuleSource, string[]>>
  ask?: Partial<Record<PermissionRuleSource, string[]>>
  deny?: Partial<Record<PermissionRuleSource, string[]>>
}): ToolPermissionContext => {
  const empty: Record<PermissionRuleSource, string[]> = {
    cliArg: [],
    session: [],
    localSettings: [],
    flagSettings: [],
    userSettings: [],
    projectSettings: [],
    policySettings: [],
    command: [],
  }
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    isBypassPermissionsModeAvailable: false,
    isAutoModeAvailable: false,
    permissionRules: [],
    alwaysAllowRules: { ...empty, ...overrides.allow },
    alwaysAskRules: { ...empty, ...overrides.ask },
    alwaysDenyRules: { ...empty, ...overrides.deny },
  } as never
}

describe('detectUnreachableRules — no shadowing', () => {
  test('empty context → no unreachable rules', () => {
    const ctx = buildContext({})
    expect(detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: false })).toEqual([])
  })

  test('only allow rules, no ask/deny → no shadowing', () => {
    const ctx = buildContext({
      allow: { localSettings: ['Bash(ls:*)', 'Bash(cat:*)'] },
    })
    expect(detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: false })).toEqual([])
  })

  test('tool-wide allow + tool-wide ask: NOT marked unreachable (no specific rule)', () => {
    // Documented: tool-wide allow rules can't be "shadowed" — only
    // specific (with ruleContent) ones are checked.
    const ctx = buildContext({
      allow: { localSettings: ['Bash'] },
      ask: { localSettings: ['Bash'] },
    })
    expect(detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: false })).toEqual([])
  })

  test('different tool: ask on Edit doesn\'t shadow Bash allow', () => {
    const ctx = buildContext({
      allow: { localSettings: ['Bash(ls:*)'] },
      ask: { localSettings: ['Edit'] },
    })
    expect(detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: false })).toEqual([])
  })
})

describe('detectUnreachableRules — deny shadowing (most severe)', () => {
  test('tool-wide Bash deny shadows specific Bash(ls:*) allow', () => {
    const ctx = buildContext({
      allow: { localSettings: ['Bash(ls:*)'] },
      deny: { policySettings: ['Bash'] },
    })
    const result = detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: false })
    expect(result).toHaveLength(1)
    expect(result[0]?.shadowType).toBe('deny')
    expect(result[0]?.reason).toContain('deny rule')
  })

  test('deny shadowing prevents ask shadowing reporting (priority)', () => {
    // Documented: when deny shadows, we DON'T also report ask shadow.
    const ctx = buildContext({
      allow: { localSettings: ['Bash(ls:*)'] },
      ask: { localSettings: ['Bash'] },
      deny: { localSettings: ['Bash'] },
    })
    const result = detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: false })
    expect(result).toHaveLength(1)
    expect(result[0]?.shadowType).toBe('deny')
  })

  test('multiple specific allow rules all flagged when tool-wide deny', () => {
    const ctx = buildContext({
      allow: { localSettings: ['Bash(ls:*)', 'Bash(cat:*)'] },
      deny: { policySettings: ['Bash'] },
    })
    const result = detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: false })
    expect(result).toHaveLength(2)
    expect(result.every(r => r.shadowType === 'deny')).toBe(true)
  })
})

describe('detectUnreachableRules — ask shadowing', () => {
  test('tool-wide ask + specific allow → shadowed', () => {
    const ctx = buildContext({
      allow: { localSettings: ['Bash(ls:*)'] },
      ask: { projectSettings: ['Bash'] },
    })
    const result = detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: false })
    expect(result).toHaveLength(1)
    expect(result[0]?.shadowType).toBe('ask')
    expect(result[0]?.reason).toContain('ask rule')
  })

  test('fix message references both rule sources', () => {
    const ctx = buildContext({
      allow: { localSettings: ['Bash(ls:*)'] },
      ask: { projectSettings: ['Bash'] },
    })
    const result = detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: false })
    expect(result[0]?.fix).toBeDefined()
    expect(typeof result[0]?.fix).toBe('string')
    expect(result[0]?.fix.length).toBeGreaterThan(0)
  })
})

describe('detectUnreachableRules — Bash sandbox auto-allow exception', () => {
  test('Bash + sandbox enabled + ask from PERSONAL settings → NOT shadowed', () => {
    // Documented: sandboxed Bash auto-allows, so the ask rule from
    // personal settings is moot.
    const ctx = buildContext({
      allow: { localSettings: ['Bash(ls:*)'] },
      ask: { localSettings: ['Bash'] }, // localSettings is personal
    })
    expect(
      detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: true }),
    ).toEqual([])
  })

  test('Bash + sandbox enabled + ask from userSettings (personal) → NOT shadowed', () => {
    const ctx = buildContext({
      allow: { localSettings: ['Bash(ls:*)'] },
      ask: { userSettings: ['Bash'] },
    })
    expect(
      detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: true }),
    ).toEqual([])
  })

  test('Bash + sandbox enabled + ask from projectSettings (SHARED) → STILL shadowed', () => {
    // Documented: shared settings always warn, even with sandbox
    // — other team members may not have sandbox enabled.
    const ctx = buildContext({
      allow: { localSettings: ['Bash(ls:*)'] },
      ask: { projectSettings: ['Bash'] },
    })
    const result = detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: true })
    expect(result).toHaveLength(1)
  })

  test('Bash + sandbox enabled + ask from policySettings (SHARED) → STILL shadowed', () => {
    const ctx = buildContext({
      allow: { localSettings: ['Bash(ls:*)'] },
      ask: { policySettings: ['Bash'] },
    })
    const result = detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: true })
    expect(result).toHaveLength(1)
  })

  test('non-Bash tool: sandbox doesn\'t apply, ask still shadows', () => {
    const ctx = buildContext({
      allow: { localSettings: ['Edit(*.ts)'] },
      ask: { localSettings: ['Edit'] },
    })
    // sandboxAutoAllowEnabled doesn't apply to Edit.
    const result = detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: true })
    expect(result).toHaveLength(1)
  })
})

describe('detectUnreachableRules — across multiple sources', () => {
  test('allow in localSettings, ask in userSettings → shadowed (across sources)', () => {
    const ctx = buildContext({
      allow: { localSettings: ['Bash(ls:*)'] },
      ask: { userSettings: ['Bash'] },
    })
    const result = detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: false })
    expect(result).toHaveLength(1)
  })

  test('all three rules in different sources still detected', () => {
    const ctx = buildContext({
      allow: { localSettings: ['Bash(ls:*)'] },
      ask: { projectSettings: ['Bash'] },
      deny: { policySettings: ['Bash'] },
    })
    const result = detectUnreachableRules(ctx, { sandboxAutoAllowEnabled: false })
    // deny wins (more severe)
    expect(result).toHaveLength(1)
    expect(result[0]?.shadowType).toBe('deny')
  })
})
