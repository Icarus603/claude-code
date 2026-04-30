/**
 * Tests for tool validation configuration helpers + plugin-only policy
 * source classifier — pure functions.
 *
 * isFilePatternTool / isBashPrefixTool / getCustomValidation drive
 * settings.json permission-rule validation. Wrong classification =
 * settings validator rejects a valid rule (e.g., WebFetch with the
 * proper "domain:" prefix accidentally rejected) OR accepts an
 * invalid one that breaks the permission system silently.
 *
 * isSourceAdminTrusted is consulted by frontmatter-hook registration
 * under strictPluginOnlyCustomization — it gates whether a custom
 * agent or command's hooks can register.
 */
import { describe, expect, test } from 'bun:test'
import {
  getCustomValidation,
  isBashPrefixTool,
  isFilePatternTool,
} from '../settings/toolValidationConfig.js'
import { isSourceAdminTrusted } from '../settings/pluginOnlyPolicy.js'

describe('isFilePatternTool — file-glob accepting tools', () => {
  test('Read → true', () => {
    expect(isFilePatternTool('Read')).toBe(true)
  })

  test('Write → true', () => {
    expect(isFilePatternTool('Write')).toBe(true)
  })

  test('Edit → true', () => {
    expect(isFilePatternTool('Edit')).toBe(true)
  })

  test('Glob → true', () => {
    expect(isFilePatternTool('Glob')).toBe(true)
  })

  test('NotebookRead / NotebookEdit → true', () => {
    expect(isFilePatternTool('NotebookRead')).toBe(true)
    expect(isFilePatternTool('NotebookEdit')).toBe(true)
  })

  test('Bash → false (Bash uses bash-prefix patterns, not glob)', () => {
    expect(isFilePatternTool('Bash')).toBe(false)
  })

  test('unknown tool → false', () => {
    expect(isFilePatternTool('UnknownTool')).toBe(false)
  })

  test('case-sensitive', () => {
    expect(isFilePatternTool('read')).toBe(false)
  })

  test('empty string → false', () => {
    expect(isFilePatternTool('')).toBe(false)
  })
})

describe('isBashPrefixTool — wildcard-accepting Bash patterns', () => {
  test('Bash → true (only Bash)', () => {
    expect(isBashPrefixTool('Bash')).toBe(true)
  })

  test('Read / Write / Edit → false', () => {
    expect(isBashPrefixTool('Read')).toBe(false)
    expect(isBashPrefixTool('Write')).toBe(false)
    expect(isBashPrefixTool('Edit')).toBe(false)
  })

  test('case-sensitive', () => {
    expect(isBashPrefixTool('bash')).toBe(false)
  })

  test('empty string → false', () => {
    expect(isBashPrefixTool('')).toBe(false)
  })
})

describe('getCustomValidation — WebSearch', () => {
  test('returns a function for WebSearch', () => {
    const v = getCustomValidation('WebSearch')
    expect(typeof v).toBe('function')
  })

  test('plain text accepted', () => {
    const v = getCustomValidation('WebSearch')!
    expect(v('claude ai')).toEqual({ valid: true })
  })

  test('content with * rejected with error + suggestion', () => {
    const v = getCustomValidation('WebSearch')!
    const r = v('foo*bar')
    expect(r.valid).toBe(false)
    expect(r.error).toContain('does not support wildcards')
    expect(r.suggestion).toContain('exact search terms')
    expect(Array.isArray(r.examples)).toBe(true)
  })

  test('content with ? rejected', () => {
    const v = getCustomValidation('WebSearch')!
    expect(v('foo?').valid).toBe(false)
  })

  test('plain ASCII without wildcards accepted', () => {
    const v = getCustomValidation('WebSearch')!
    expect(v('typescript tutorial').valid).toBe(true)
  })
})

describe('getCustomValidation — WebFetch', () => {
  test('valid domain: prefix accepted', () => {
    const v = getCustomValidation('WebFetch')!
    expect(v('domain:example.com')).toEqual({ valid: true })
  })

  test('domain: with wildcard accepted', () => {
    const v = getCustomValidation('WebFetch')!
    expect(v('domain:*.example.com')).toEqual({ valid: true })
    expect(v('domain:example.*')).toEqual({ valid: true })
  })

  test('URL with :// rejected', () => {
    const v = getCustomValidation('WebFetch')!
    const r = v('https://example.com')
    expect(r.valid).toBe(false)
    expect(r.error).toContain('domain format')
    expect(r.suggestion).toContain('domain:hostname')
  })

  test('URL with http prefix rejected', () => {
    const v = getCustomValidation('WebFetch')!
    expect(v('http://example.com').valid).toBe(false)
  })

  test('content without domain: prefix rejected', () => {
    const v = getCustomValidation('WebFetch')!
    const r = v('example.com')
    expect(r.valid).toBe(false)
    expect(r.error).toContain('domain:')
  })

  test('empty string rejected (no domain: prefix)', () => {
    const v = getCustomValidation('WebFetch')!
    expect(v('').valid).toBe(false)
  })

  test('domain: prefix without value still passes (caller validates downstream)', () => {
    // The validator only checks that "domain:" is the prefix; emptiness
    // beyond that is the caller's responsibility.
    const v = getCustomValidation('WebFetch')!
    expect(v('domain:').valid).toBe(true)
  })
})

describe('getCustomValidation — unknown tools', () => {
  test('unknown tool → undefined (no custom validation)', () => {
    expect(getCustomValidation('UnknownTool')).toBeUndefined()
  })

  test('Bash has no custom validator (uses bashPrefix path)', () => {
    expect(getCustomValidation('Bash')).toBeUndefined()
  })

  test('Read has no custom validator', () => {
    expect(getCustomValidation('Read')).toBeUndefined()
  })
})

describe('isSourceAdminTrusted — strictPluginOnlyCustomization bypass', () => {
  test('plugin → true', () => {
    expect(isSourceAdminTrusted('plugin')).toBe(true)
  })

  test('policySettings → true (admin-controlled)', () => {
    expect(isSourceAdminTrusted('policySettings')).toBe(true)
  })

  test('built-in (with hyphen, AgentDefinition style) → true', () => {
    expect(isSourceAdminTrusted('built-in')).toBe(true)
  })

  test('builtin (no hyphen, Command style) → true', () => {
    expect(isSourceAdminTrusted('builtin')).toBe(true)
  })

  test('bundled (Command style) → true', () => {
    expect(isSourceAdminTrusted('bundled')).toBe(true)
  })

  test('userSettings → false (user-authored)', () => {
    expect(isSourceAdminTrusted('userSettings')).toBe(false)
  })

  test('projectSettings / localSettings / flagSettings → false', () => {
    expect(isSourceAdminTrusted('projectSettings')).toBe(false)
    expect(isSourceAdminTrusted('localSettings')).toBe(false)
    expect(isSourceAdminTrusted('flagSettings')).toBe(false)
  })

  test('mcp → false', () => {
    expect(isSourceAdminTrusted('mcp')).toBe(false)
  })

  test('undefined → false', () => {
    expect(isSourceAdminTrusted(undefined)).toBe(false)
  })

  test('empty string → false', () => {
    expect(isSourceAdminTrusted('')).toBe(false)
  })

  test('case-sensitive', () => {
    expect(isSourceAdminTrusted('Plugin')).toBe(false)
    expect(isSourceAdminTrusted('PLUGIN')).toBe(false)
  })

  test('arbitrary string → false', () => {
    expect(isSourceAdminTrusted('untrusted-source-name')).toBe(false)
  })
})
