import { describe, expect, test } from 'bun:test'
import {
  hasStdinRedirect,
  quoteShellCommand,
  rewriteWindowsNullRedirect,
  shouldAddStdinRedirect,
} from '../bash/shellQuoting.js'

describe('hasStdinRedirect', () => {
  test('detects standard < file redirect', () => {
    expect(hasStdinRedirect('sort < input.txt')).toBe(true)
  })
  test('detects < /dev/null', () => {
    expect(hasStdinRedirect('cmd < /dev/null')).toBe(true)
  })
  test('returns false for plain commands', () => {
    expect(hasStdinRedirect('echo hello')).toBe(false)
  })
  test('does NOT confuse heredoc <<', () => {
    expect(hasStdinRedirect('cat <<EOF\nx\nEOF')).toBe(false)
  })
  test('does NOT confuse process substitution <(...)', () => {
    expect(hasStdinRedirect('diff <(ls a) <(ls b)')).toBe(false)
  })
  test('does NOT match middle-of-word "<"', () => {
    expect(hasStdinRedirect('echo "x<y"')).toBe(false)
  })
  test('detects redirect after pipe', () => {
    expect(hasStdinRedirect('foo | bar < input')).toBe(true)
  })
})

describe('shouldAddStdinRedirect', () => {
  test('true for plain command', () => {
    expect(shouldAddStdinRedirect('ls')).toBe(true)
  })
  test('false when command already has stdin redirect', () => {
    expect(shouldAddStdinRedirect('sort < input.txt')).toBe(false)
  })
  test('false for heredoc commands (would conflict with terminator)', () => {
    expect(shouldAddStdinRedirect('cat <<EOF\nfoo\nEOF')).toBe(false)
  })
})

describe('quoteShellCommand (regular path)', () => {
  test('wraps a simple command for safe eval', () => {
    const result = quoteShellCommand('echo hello', false)
    expect(result).toContain('echo hello')
  })
  test('appends stdin redirect by default', () => {
    expect(quoteShellCommand('ls')).toContain('/dev/null')
  })
  test('does not append stdin redirect when disabled', () => {
    expect(quoteShellCommand('ls', false)).not.toContain('/dev/null')
  })
})

describe('quoteShellCommand (heredoc path)', () => {
  test('preserves heredoc content', () => {
    const cmd = 'cat <<EOF\nhello\nEOF'
    const result = quoteShellCommand(cmd)
    expect(result).toContain('cat')
    expect(result).toContain('EOF')
  })
  test('does NOT add stdin redirect for heredoc (would clobber input)', () => {
    const cmd = 'cat <<EOF\nfoo\nEOF'
    expect(quoteShellCommand(cmd)).not.toContain('/dev/null')
  })
  test('escapes single quotes within heredoc body', () => {
    const cmd = "cat <<EOF\nit's\nEOF"
    const result = quoteShellCommand(cmd)
    // Single quote escape uses '"'"' pattern
    expect(result).toContain(`'"'"'`)
  })
})

describe('rewriteWindowsNullRedirect', () => {
  test('converts >nul to >/dev/null', () => {
    expect(rewriteWindowsNullRedirect('ls >nul')).toBe('ls >/dev/null')
  })
  test('converts >NUL (uppercase)', () => {
    expect(rewriteWindowsNullRedirect('ls >NUL')).toBe('ls >/dev/null')
  })
  test('converts 2>nul (stderr)', () => {
    expect(rewriteWindowsNullRedirect('ls 2>nul')).toBe('ls 2>/dev/null')
  })
  test('converts &>nul (both streams)', () => {
    expect(rewriteWindowsNullRedirect('ls &>nul')).toBe('ls &>/dev/null')
  })
  test('converts >>nul (append)', () => {
    expect(rewriteWindowsNullRedirect('ls >>nul')).toBe('ls >>/dev/null')
  })
  test('does NOT match >null (different name)', () => {
    expect(rewriteWindowsNullRedirect('ls >null')).toBe('ls >null')
  })
  test('does NOT match >nul.txt (filename starting with nul)', () => {
    expect(rewriteWindowsNullRedirect('ls >nul.txt')).toBe('ls >nul.txt')
  })
  test('does NOT match middle-of-word "nul"', () => {
    expect(rewriteWindowsNullRedirect('cat nul.txt')).toBe('cat nul.txt')
  })
  test('handles multiple redirects in one command', () => {
    expect(rewriteWindowsNullRedirect('cmd >nul 2>nul')).toBe(
      'cmd >/dev/null 2>/dev/null',
    )
  })
  test('preserves command body when no nul redirect', () => {
    expect(rewriteWindowsNullRedirect('echo hello')).toBe('echo hello')
  })
  test('regression: does not mangle "ls >null" (previously could match start)', () => {
    // Negative lookahead — `null` keeps its name
    expect(rewriteWindowsNullRedirect('echo > null')).toBe('echo > null')
  })
})
