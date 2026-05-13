import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

import { estimateSkillFrontmatterTokens, getSkillsPath } from '../loadSkillsDir.ts'

/**
 * Pin skill path resolution + frontmatter token estimation. Skills are
 * loaded from multiple sources (user, project, policy, plugin); path
 * conventions are user-visible and tooling-documented.
 *
 * estimateSkillFrontmatterTokens is what the /context display uses to
 * report "skill load cost" — wrong values mislead users into uninstalling
 * helpful skills.
 */
describe('Skills path + token estimation invariants', () => {
  describe('getSkillsPath', () => {
    test('userSettings → <CLAUDE_CONFIG_HOME>/<dir>', () => {
      // Pin the structural form by checking the relative tail; the
      // absolute base is tested by integration tests.
      const path = getSkillsPath('userSettings', 'skills')
      expect(path).toMatch(/\/skills$/)
    })

    test('projectSettings → .claude/<dir> (relative to cwd, not absolute)', () => {
      expect(getSkillsPath('projectSettings', 'skills')).toBe('.claude/skills')
      expect(getSkillsPath('projectSettings', 'commands')).toBe('.claude/commands')
    })

    test('plugin → marker string "plugin" (not a real path)', () => {
      // Plugin-sourced skills are resolved via the plugin loader, not
      // directly from disk. The marker just identifies provenance.
      expect(getSkillsPath('plugin', 'skills')).toBe('plugin')
    })

    test('policySettings → managed-files .claude/<dir>', () => {
      const path = getSkillsPath('policySettings', 'commands')
      // Has the managed-files .claude prefix
      expect(path).toMatch(/\.claude\/commands$/)
    })

    test('unknown source → empty string (defensive default)', () => {
      // Casting to bypass type — runtime defensive against future enum
      // additions where caller forgot to add a case.
      expect(getSkillsPath('localSettings' as never, 'skills')).toBe('')
    })

    test('only handles "skills" or "commands" dir names', () => {
      // Type-level enforced but pin runtime behavior anyway
      expect(getSkillsPath('userSettings', 'skills')).toMatch(/\/skills$/)
      expect(getSkillsPath('userSettings', 'commands')).toMatch(/\/commands$/)
    })
  })

  describe('estimateSkillFrontmatterTokens', () => {
    test('estimates ONLY from name + description + whenToUse (NOT full content)', () => {
      // Skills can have multi-KB markdown content. Loading all that
      // upfront would balloon the per-skill estimate; the bytes only
      // arrive when the skill is invoked. Pin the frontmatter-only
      // estimation to keep /context accurate.
      const skill = {
        name: 'pdf',
        description: 'Convert PDF to text',
        whenToUse: 'When user asks to extract PDF content',
        body: 'a'.repeat(50000), // 50KB body, irrelevant to estimate
      } as any
      const estimate = estimateSkillFrontmatterTokens(skill)
      // Frontmatter is ~60 chars → ~15 tokens. Body of 50KB is excluded.
      expect(estimate).toBeLessThan(50)
    })

    test('filters out falsy fields (undefined/empty strings)', () => {
      // A skill with no whenToUse field shouldn't crash the estimator
      // (undefined → filter out, not join " undefined ").
      const skill = {
        name: 'test',
        description: undefined,
        whenToUse: '',
      } as any
      const estimate = estimateSkillFrontmatterTokens(skill)
      expect(typeof estimate).toBe('number')
      expect(estimate).toBeGreaterThanOrEqual(1)
    })

    test('uses roughTokenCountEstimation under the hood (not API counting)', () => {
      // /context is called frequently and synchronously; using the API
      // count would block on a network round-trip. Pin the local helper.
      const source = readFileSync(
        resolve(__dirname, '..', 'loadSkillsDir.ts'),
        'utf-8',
      )
      const fnStart = source.indexOf('export function estimateSkillFrontmatterTokens')
      const fnSlice = source.slice(fnStart, fnStart + 400)
      expect(fnSlice).toMatch(/roughTokenCountEstimation\(frontmatterText\)/)
    })
  })
})
