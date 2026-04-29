/**
 * Tests for skill helper functions.
 *
 * estimateSkillFrontmatterTokens drives the discovery-budget filter —
 * skills are surfaced via attachments based on token cost. Wrong math
 * either over-injects (slow first turn) or under-injects (skills that
 * should be visible are silently dropped).
 *
 * getSkillsPath maps SettingSource → directory path. A typo here loads
 * skills from the wrong scope and a project-scoped skill stops working.
 */
import { describe, expect, mock, test } from 'bun:test'

// Mock the path-discovery deps so we don't drag in env-dependent behaviour.
const realConfig = await import('@claude-code/config/env/utils')
mock.module('@claude-code/config/env/utils', () => ({
  ...realConfig,
  getClaudeConfigHomeDir: () => '/home/user/.claude',
}))

const realManaged = await import('@claude-code/config/managedPath')
mock.module('@claude-code/config/managedPath', () => ({
  ...realManaged,
  getManagedFilePath: () => '/etc/claude',
}))

const { estimateSkillFrontmatterTokens, getSkillsPath } = await import(
  '../skills/loadSkillsDir.js'
)

describe('getSkillsPath — directory mapping', () => {
  test('userSettings + skills → ~/.claude/skills', () => {
    expect(getSkillsPath('userSettings', 'skills')).toBe(
      '/home/user/.claude/skills',
    )
  })

  test('userSettings + commands → ~/.claude/commands', () => {
    expect(getSkillsPath('userSettings', 'commands')).toBe(
      '/home/user/.claude/commands',
    )
  })

  test('projectSettings + skills → .claude/skills (relative)', () => {
    expect(getSkillsPath('projectSettings', 'skills')).toBe('.claude/skills')
  })

  test('projectSettings + commands → .claude/commands (relative)', () => {
    expect(getSkillsPath('projectSettings', 'commands')).toBe(
      '.claude/commands',
    )
  })

  test('policySettings + skills → managed/.claude/skills', () => {
    expect(getSkillsPath('policySettings', 'skills')).toBe(
      '/etc/claude/.claude/skills',
    )
  })

  test('plugin source → "plugin" sentinel', () => {
    expect(getSkillsPath('plugin', 'skills')).toBe('plugin')
    expect(getSkillsPath('plugin', 'commands')).toBe('plugin')
  })

  test('unknown source → empty string (fallback)', () => {
    // The switch's default branch returns ''. Document this so a typo
    // in the SettingSource type doesn't silently load from cwd.
    expect(getSkillsPath('unknown' as never, 'skills')).toBe('')
  })
})

describe('estimateSkillFrontmatterTokens', () => {
  function skill(over: Partial<{
    name: string
    description: string
    whenToUse: string | undefined
  }>): Parameters<typeof estimateSkillFrontmatterTokens>[0] {
    return {
      name: over.name ?? '',
      description: over.description ?? '',
      whenToUse: over.whenToUse,
    } as Parameters<typeof estimateSkillFrontmatterTokens>[0]
  }

  test('all-empty frontmatter → 0 tokens', () => {
    expect(estimateSkillFrontmatterTokens(skill({}))).toBe(0)
  })

  test('name only counted when present', () => {
    // 4-char name "test" → 1 token (round(4/4))
    expect(estimateSkillFrontmatterTokens(skill({ name: 'test' }))).toBe(1)
  })

  test('description only counted when present', () => {
    // 12-char "describe me!" / 4 = 3
    expect(
      estimateSkillFrontmatterTokens(skill({ description: 'describe me!' })),
    ).toBe(3)
  })

  test('whenToUse counted when present, skipped when undefined', () => {
    expect(
      estimateSkillFrontmatterTokens(
        skill({ name: 'a', description: 'b', whenToUse: 'c' }),
      ),
    ).toBe(estimateSkillFrontmatterTokens(skill({ name: 'a b c' })))
  })

  test('three fields combined produce single token estimate', () => {
    // Joined by space: "name description when" → length 21 chars → 5 tokens
    const result = estimateSkillFrontmatterTokens(
      skill({
        name: 'name',
        description: 'description',
        whenToUse: 'when',
      }),
    )
    // Math.round((4+1+11+1+4) / 4) = round(5.25) = 5
    expect(result).toBe(5)
  })

  test('empty-string fields filtered out (no leading/trailing whitespace)', () => {
    // The function uses .filter(Boolean) — empty string is falsy.
    expect(
      estimateSkillFrontmatterTokens(
        skill({ name: 'a', description: '', whenToUse: 'b' }),
      ),
    ).toBe(estimateSkillFrontmatterTokens(skill({ name: 'a b' })))
  })

  test('CJK-heavy frontmatter uses 1.5x ratio (Chinese skill name)', () => {
    // 10 CJK chars × 1.5 = 15 tokens
    const result = estimateSkillFrontmatterTokens(
      skill({ name: '中文技能名稱呃啊噠呢' }),
    )
    expect(result).toBe(15)
  })
})
