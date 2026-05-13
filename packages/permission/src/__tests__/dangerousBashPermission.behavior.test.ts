import { describe, expect, test } from 'bun:test'

import { isDangerousBashPermission } from '../permissionSetup.ts'

const BASH = 'Bash'

/**
 * Pin isDangerousBashPermission — the auto-mode safety gate. Marks
 * allow-rules that would auto-execute arbitrary code (python, ruby, perl,
 * shell wrappers, etc.) without classifier review.
 *
 * False negative → user enables auto-mode with `Bash(python:*)` allow,
 *   model can run arbitrary Python → arbitrary code execution
 * False positive → user's legitimate `Bash(git:*)` gets stripped from
 *   auto-mode, friction
 */
describe('isDangerousBashPermission (auto-mode safety gate)', () => {
  test('Non-Bash tool → always false', () => {
    expect(isDangerousBashPermission('Write', '*')).toBe(false)
    expect(isDangerousBashPermission('Edit', 'python')).toBe(false)
  })

  test('Bash with no content (tool-level allow) → DANGEROUS', () => {
    // `Bash` rule with no content matches every command.
    expect(isDangerousBashPermission(BASH, undefined)).toBe(true)
    expect(isDangerousBashPermission(BASH, '')).toBe(true)
  })

  test('Standalone "*" wildcard → DANGEROUS', () => {
    expect(isDangerousBashPermission(BASH, '*')).toBe(true)
  })

  test('Bare dangerous pattern (e.g. "python") → DANGEROUS', () => {
    expect(isDangerousBashPermission(BASH, 'python')).toBe(true)
  })

  test('Prefix syntax "python:*" → DANGEROUS (allows any python invocation)', () => {
    expect(isDangerousBashPermission(BASH, 'python:*')).toBe(true)
  })

  test('Wildcard "python*" → DANGEROUS (matches python3, python2.7, etc.)', () => {
    expect(isDangerousBashPermission(BASH, 'python*')).toBe(true)
  })

  test('Wildcard with space "python *" → DANGEROUS (matches "python script.py")', () => {
    expect(isDangerousBashPermission(BASH, 'python *')).toBe(true)
  })

  test('Option-prefix wildcard "python -*" → DANGEROUS (matches "python -c \'code\'")', () => {
    expect(isDangerousBashPermission(BASH, 'python -c *')).toBe(true)
  })

  test('Case-insensitive matching ("PYTHON*" → DANGEROUS)', () => {
    expect(isDangerousBashPermission(BASH, 'PYTHON*')).toBe(true)
    expect(isDangerousBashPermission(BASH, 'Python:*')).toBe(true)
  })

  test('Whitespace-only rule trimmed and treated as bare dangerous-pattern check', () => {
    // After trim → "" → matches no dangerous pattern
    expect(isDangerousBashPermission(BASH, '   ')).toBe(false)
  })

  test('SAFE: explicit pinned command (e.g. "python script.py") → false', () => {
    // Pinned to a specific command file, not a class of operations.
    expect(isDangerousBashPermission(BASH, 'python script.py')).toBe(false)
  })

  test('SAFE: git commands (not in dangerous patterns)', () => {
    expect(isDangerousBashPermission(BASH, 'git:*')).toBe(false)
    expect(isDangerousBashPermission(BASH, 'git status')).toBe(false)
  })

  test('SAFE: ls / cat / grep (read-only commands)', () => {
    expect(isDangerousBashPermission(BASH, 'ls')).toBe(false)
    expect(isDangerousBashPermission(BASH, 'cat:*')).toBe(false)
    expect(isDangerousBashPermission(BASH, 'grep')).toBe(false)
  })

  test('SAFE: npm/yarn/bun/pnpm package managers (specific tools)', () => {
    // Package managers ARE NOT in the dangerous-pattern list because
    // they have their own permission scoping and don't directly execute
    // arbitrary user code paths the way `python -c` does.
    expect(isDangerousBashPermission(BASH, 'npm install')).toBe(false)
    expect(isDangerousBashPermission(BASH, 'bun:*')).toBe(false)
  })
})
