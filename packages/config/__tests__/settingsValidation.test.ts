/**
 * Tests for validateSettingsFileContent + filterInvalidPermissionRules
 * — front-line defense for `~/.claude/settings.json` and project
 * `.claude/settings.json` files.
 *
 * filterInvalidPermissionRules MUTATES the input — it removes bad rules
 * from the input data so the schema validator sees clean rules. Without
 * it, one bad rule would fail the whole settings load and lock the user
 * out. Tests lock the prune-and-warn semantics.
 *
 * validateSettingsFileContent gates settings.json edits via the
 * /edit-settings flow. Wrong validation = silent acceptance of broken
 * config that breaks at runtime, OR false rejection of valid edits.
 */
import { describe, expect, test } from 'bun:test'
import {
  filterInvalidPermissionRules,
  validateSettingsFileContent,
} from '../settings/validation.js'

describe('validateSettingsFileContent — accepted shapes', () => {
  test('empty object is valid', () => {
    expect(validateSettingsFileContent('{}')).toEqual({ isValid: true })
  })

  test('valid env field', () => {
    const r = validateSettingsFileContent('{"env":{"DEBUG":"1"}}')
    expect(r.isValid).toBe(true)
  })

  test('valid permissions structure', () => {
    const r = validateSettingsFileContent(
      JSON.stringify({
        permissions: {
          allow: ['Bash(ls)'],
          deny: [],
        },
      }),
    )
    expect(r.isValid).toBe(true)
  })

  test('arbitrary whitespace + newlines accepted', () => {
    const r = validateSettingsFileContent(`{
      "env": {
        "FOO": "bar"
      }
    }`)
    expect(r.isValid).toBe(true)
  })
})

describe('validateSettingsFileContent — JSON parse errors', () => {
  test('malformed JSON: missing closing brace', () => {
    const r = validateSettingsFileContent('{"env":{"DEBUG":"1"')
    expect(r.isValid).toBe(false)
    if (!r.isValid) {
      expect(r.error).toContain('Invalid JSON')
      expect(r.fullSchema).toBeDefined()
    }
  })

  test('malformed JSON: trailing comma', () => {
    const r = validateSettingsFileContent('{"env":{"X":"1",}}')
    expect(r.isValid).toBe(false)
    if (!r.isValid) {
      expect(r.error).toContain('Invalid JSON')
    }
  })

  test('empty string fails parse', () => {
    const r = validateSettingsFileContent('')
    expect(r.isValid).toBe(false)
  })

  test('non-JSON content (plain text) fails', () => {
    const r = validateSettingsFileContent('hello world')
    expect(r.isValid).toBe(false)
    if (!r.isValid) {
      expect(r.error).toContain('Invalid JSON')
    }
  })
})

describe('validateSettingsFileContent — schema violations', () => {
  test('JSON null is parsed but fails schema validation', () => {
    const r = validateSettingsFileContent('null')
    expect(r.isValid).toBe(false)
    if (!r.isValid) {
      // Either "Invalid or malformed JSON" (the special-cased shape) or
      // a strict-mode reject. Both legitimate shapes — lock either.
      expect(typeof r.error).toBe('string')
      expect(r.error.length).toBeGreaterThan(0)
    }
  })

  test('JSON array (not object) fails schema', () => {
    const r = validateSettingsFileContent('[]')
    expect(r.isValid).toBe(false)
  })

  test('unknown top-level field rejected by strict mode', () => {
    // Strict() mode rejects unrecognized keys.
    const r = validateSettingsFileContent('{"unknownField":42}')
    expect(r.isValid).toBe(false)
    if (!r.isValid) {
      expect(r.error).toMatch(/Settings validation failed|Unrecognized/)
    }
  })

  test('error includes fullSchema for user help', () => {
    const r = validateSettingsFileContent('{"unknownField":42}')
    expect(r.isValid).toBe(false)
    if (!r.isValid) {
      expect(r.fullSchema).toBeDefined()
      expect(typeof r.fullSchema).toBe('string')
      expect(r.fullSchema.length).toBeGreaterThan(0)
    }
  })
})

describe('filterInvalidPermissionRules — happy paths', () => {
  test('empty data → empty warnings', () => {
    expect(filterInvalidPermissionRules({}, 'settings')).toEqual([])
  })

  test('no permissions field → empty warnings', () => {
    expect(filterInvalidPermissionRules({ env: { X: '1' } }, 'settings')).toEqual(
      [],
    )
  })

  test('null/undefined → empty warnings', () => {
    expect(filterInvalidPermissionRules(null, 'settings')).toEqual([])
    expect(filterInvalidPermissionRules(undefined, 'settings')).toEqual([])
  })

  test('permissions but no allow/deny/ask arrays → empty warnings', () => {
    expect(
      filterInvalidPermissionRules({ permissions: {} }, 'settings'),
    ).toEqual([])
  })

  test('all-valid rules → empty warnings, data unchanged', () => {
    const data = {
      permissions: {
        allow: ['Bash', 'Edit(*.ts)'],
        deny: ['Bash(rm)'],
      },
    }
    const warnings = filterInvalidPermissionRules(data, 'settings')
    expect(warnings).toEqual([])
    expect((data.permissions as unknown as { allow: string[] }).allow).toEqual([
      'Bash',
      'Edit(*.ts)',
    ])
  })
})

describe('filterInvalidPermissionRules — invalid rule pruning', () => {
  test('mismatched parens rule pruned + warning emitted', () => {
    const data = {
      permissions: {
        allow: ['Bash', 'Bash((bad'],
      },
    }
    const warnings = filterInvalidPermissionRules(data, 'settings')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.path).toBe('permissions.allow')
    expect(warnings[0]?.message).toContain('Invalid permission rule')
    expect(warnings[0]?.invalidValue).toBe('Bash((bad')
    // Bad rule pruned from the input data (in-place mutation).
    const allow = (data.permissions as unknown as { allow: string[] }).allow
    expect(allow).toEqual(['Bash'])
  })

  test('non-string entry pruned + special warning', () => {
    const data = {
      permissions: {
        deny: ['Bash', 42 as unknown as string, null],
      },
    }
    const warnings = filterInvalidPermissionRules(data, 'settings')
    expect(warnings.length).toBe(2) // 42 + null
    expect(warnings[0]?.message).toContain('Non-string')
    const deny = (data.permissions as unknown as { deny: string[] }).deny
    expect(deny).toEqual(['Bash'])
  })

  test('multiple bad rules in same array all pruned', () => {
    const data = {
      permissions: {
        ask: ['Bash', 'Bash(()', 'lowercase'],
      },
    }
    const warnings = filterInvalidPermissionRules(data, 'settings')
    expect(warnings.length).toBeGreaterThanOrEqual(2)
    const ask = (data.permissions as unknown as { ask: string[] }).ask
    expect(ask).toEqual(['Bash'])
  })

  test('warnings include filePath in `file` field', () => {
    const data = { permissions: { allow: ['bad rule (with parens'] } }
    const warnings = filterInvalidPermissionRules(data, '/path/to/.claude/settings.json')
    expect(warnings[0]?.file).toBe('/path/to/.claude/settings.json')
  })

  test('warning message contains the bad rule string', () => {
    const data = { permissions: { allow: ['Bash(()'] } }
    const warnings = filterInvalidPermissionRules(data, 'settings')
    expect(warnings[0]?.message).toContain('Bash(()')
  })

  test('handles all 3 keys (allow/deny/ask) independently', () => {
    const data = {
      permissions: {
        allow: ['Bash(()'],
        deny: ['lowercase'],
        ask: ['Bash(()'],
      },
    }
    const warnings = filterInvalidPermissionRules(data, 'settings')
    // 3 separate warnings (one per array).
    expect(warnings.length).toBe(3)
    const allow = (data.permissions as unknown as { allow: string[] }).allow
    const deny = (data.permissions as unknown as { deny: string[] }).deny
    const ask = (data.permissions as unknown as { ask: string[] }).ask
    expect(allow).toEqual([])
    expect(deny).toEqual([])
    expect(ask).toEqual([])
  })
})

describe('filterInvalidPermissionRules — edge cases', () => {
  test('non-array allow/deny/ask field skipped (no crash)', () => {
    const data = {
      permissions: {
        allow: 'not an array' as unknown as string[],
        deny: ['Bash'],
      },
    }
    const warnings = filterInvalidPermissionRules(data, 'settings')
    // The non-array allow is skipped (no warning); the valid deny passes.
    expect(warnings).toEqual([])
  })

  test('keys other than allow/deny/ask ignored', () => {
    const data = {
      permissions: {
        allow: ['Bash'],
        somethingElse: ['junk'],
      },
    }
    const warnings = filterInvalidPermissionRules(data, 'settings')
    expect(warnings).toEqual([])
  })

  test('deeply nested permissions field NOT processed (only top-level)', () => {
    const data = {
      nested: {
        permissions: { allow: ['Bash(()'] },
      },
    }
    const warnings = filterInvalidPermissionRules(data, 'settings')
    expect(warnings).toEqual([])
  })

  test('empty arrays are no-ops', () => {
    const data = {
      permissions: { allow: [], deny: [], ask: [] },
    }
    expect(filterInvalidPermissionRules(data, 'settings')).toEqual([])
  })
})
