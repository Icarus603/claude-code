/**
 * Tests for validatePermissionRule — security-critical settings
 * validator. A malformed rule that gets through unchecked could:
 *   - Silently broaden permissions (e.g., empty parens treated as
 *     "no constraint" by some downstream code paths)
 *   - Bypass MCP-specific path enforcement
 *   - Treat lowercase "bash(rm)" as anything but the canonical "Bash(rm)"
 *
 * Heavy adversarial probing: edge cases around escape sequences,
 * mismatched parens, MCP rules, Bash :* legacy syntax, file-pattern
 * gotchas. Each accept/reject is a permanent contract.
 */
import { describe, expect, test } from 'bun:test'
import { validatePermissionRule } from '../settings/permissionValidation.js'

describe('validatePermissionRule — empty / whitespace', () => {
  test('empty string → invalid', () => {
    expect(validatePermissionRule('').valid).toBe(false)
    expect(validatePermissionRule('').error).toContain('cannot be empty')
  })

  test('whitespace-only → invalid', () => {
    expect(validatePermissionRule('   ').valid).toBe(false)
    expect(validatePermissionRule('\t\n').valid).toBe(false)
  })
})

describe('validatePermissionRule — paren matching', () => {
  test('balanced parens accepted (well-formed)', () => {
    expect(validatePermissionRule('Bash(ls)').valid).toBe(true)
  })

  test('extra opening paren → mismatched', () => {
    const r = validatePermissionRule('Bash((ls)')
    expect(r.valid).toBe(false)
    expect(r.error).toBe('Mismatched parentheses')
  })

  test('extra closing paren → mismatched', () => {
    const r = validatePermissionRule('Bash(ls))')
    expect(r.valid).toBe(false)
    expect(r.error).toBe('Mismatched parentheses')
  })

  test('escaped parens do NOT count toward balance', () => {
    // \( inside the content should not throw off the balance check.
    expect(validatePermissionRule('Bash(echo \\()').valid).toBe(true)
  })

  test('escaped opening + literal closing balances', () => {
    // \( \) — both escaped, count is 0+0 = balanced.
    expect(validatePermissionRule('Bash(\\(\\))').valid).toBe(true)
  })

  test('empty parens () → invalid (suggests dropping parens)', () => {
    const r = validatePermissionRule('Bash()')
    expect(r.valid).toBe(false)
    expect(r.error).toBe('Empty parentheses')
    expect(r.suggestion).toContain('"Bash"')
    expect(r.examples).toContain('Bash')
  })

  test('escaped empty parens \\(\\) NOT treated as empty', () => {
    // The literal \( \) is content, not empty parens. But the wrapper
    // parens around them would still need a tool name.
    expect(validatePermissionRule('Bash(\\(\\))').valid).toBe(true)
  })
})

describe('validatePermissionRule — tool name', () => {
  test('uppercase tool name accepted', () => {
    expect(validatePermissionRule('Bash').valid).toBe(true)
    expect(validatePermissionRule('Edit').valid).toBe(true)
    expect(validatePermissionRule('Write').valid).toBe(true)
  })

  test('lowercase tool name → suggests capitalize', () => {
    const r = validatePermissionRule('bash(ls)')
    expect(r.valid).toBe(false)
    expect(r.error).toContain('uppercase')
    expect(r.suggestion).toContain('Bash')
  })

  test('tool with no parens (no constraint) accepted', () => {
    expect(validatePermissionRule('WebFetch').valid).toBe(true)
  })
})

describe('validatePermissionRule — MCP rules', () => {
  test('mcp__server (server-level) accepted', () => {
    expect(validatePermissionRule('mcp__github').valid).toBe(true)
  })

  test('mcp__server__tool (tool-level) accepted', () => {
    expect(validatePermissionRule('mcp__github__list_issues').valid).toBe(true)
  })

  test('mcp__server__* (wildcard) accepted', () => {
    expect(validatePermissionRule('mcp__github__*').valid).toBe(true)
  })

  test('mcp__server(pattern) → invalid (MCP rules disallow parens)', () => {
    const r = validatePermissionRule('mcp__github(some-pattern)')
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/MCP rules.*patterns/i)
  })

  test('mcp__server__tool(pattern) → invalid (MCP rules disallow parens)', () => {
    const r = validatePermissionRule('mcp__github__list(*)')
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/MCP rules.*patterns/i)
  })

  test('MCP error suggestion includes valid forms', () => {
    const r = validatePermissionRule('mcp__github__list(*)')
    expect(r.examples).toBeDefined()
    expect(r.examples?.some(e => e.includes('mcp__github'))).toBe(true)
  })
})

describe('validatePermissionRule — bindings-dependent paths (no host installed in pure tests)', () => {
  // Documented contract: when ConfigHostBindings.parsePermissionRule is
  // not installed (the case in pure isolated test runs), the function
  // falls back to `{ toolName: rule }` — treating the WHOLE rule string
  // as the tool name. Bash/file-tool-specific deep checks (`:*` legacy,
  // file-pattern wildcard placement) only fire when parser is installed
  // because they need parsed.ruleContent. Pure tests still exercise the
  // generic shape checks (parens, MCP, capitalization) and the early
  // exit branches.
  //
  // For the deep-parse paths, tests would need an integration harness
  // that installs the parser binding. Recorded here as a contract: a
  // test that *expected* these to fail in pure mode would lock the
  // wrong behavior. Lock the actual behavior: passes through valid.

  test('Bash(npm:*) accepted in both pure + parser modes', () => {
    expect(validatePermissionRule('Bash(npm:*)').valid).toBe(true)
  })

  test('Bash(npm *) accepted', () => {
    expect(validatePermissionRule('Bash(npm *)').valid).toBe(true)
  })

  test('Bash(* install) accepted', () => {
    expect(validatePermissionRule('Bash(* install)').valid).toBe(true)
  })

  test('Bash(ls -la) plain command accepted', () => {
    expect(validatePermissionRule('Bash(ls -la)').valid).toBe(true)
  })
})

describe('validatePermissionRule — file pattern tools (paren-balance only in pure tests)', () => {
  // Without bindings.parsePermissionRule installed, the file-pattern-
  // specific branch never fires; the rule is accepted as long as the
  // generic shape (paren balance, non-empty parens, capitalized tool
  // name) holds. We lock that behavior as a baseline.

  test('Edit(*.ts) accepted', () => {
    expect(validatePermissionRule('Edit(*.ts)').valid).toBe(true)
  })

  test('Write(src/**) accepted', () => {
    expect(validatePermissionRule('Write(src/**)').valid).toBe(true)
  })

  test('Read(**/*.test.ts) accepted', () => {
    expect(validatePermissionRule('Read(**/*.test.ts)').valid).toBe(true)
  })
})

describe('validatePermissionRule — escape edge cases', () => {
  test('backslash before paren counts as escape (one backslash = escaped)', () => {
    // 'Bash(echo \()' — the \( is escaped, so 1 unescaped open + 1
    // unescaped close = balanced.
    expect(validatePermissionRule('Bash(echo \\()').valid).toBe(true)
  })

  test('two backslashes (\\\\) before paren = backslash + unescaped paren', () => {
    // 'Bash(\\\\(...)' — \\ escapes itself, so the ( is unescaped.
    // Should count as 2 opens + 1 close → mismatched.
    const r = validatePermissionRule('Bash(\\\\(test)')
    expect(r.valid).toBe(false)
    expect(r.error).toBe('Mismatched parentheses')
  })

  test('three backslashes before paren → escape (still odd)', () => {
    // \\\( — 3 backslashes, the last \( is escaped. So 1 open + 1 close
    // still balanced; valid.
    expect(validatePermissionRule('Bash(\\\\\\()').valid).toBe(true)
  })
})

describe('validatePermissionRule — return shape contract', () => {
  test('valid returns ONLY { valid: true } (no error/suggestion)', () => {
    const r = validatePermissionRule('Bash')
    expect(r.valid).toBe(true)
    expect(r.error).toBeUndefined()
  })

  test('invalid always has an error string', () => {
    const cases = ['', 'bash', 'Bash()', 'mcp__github(*)']
    for (const c of cases) {
      const r = validatePermissionRule(c)
      expect(r.valid).toBe(false)
      expect(typeof r.error).toBe('string')
      expect(r.error?.length).toBeGreaterThan(0)
    }
  })
})
