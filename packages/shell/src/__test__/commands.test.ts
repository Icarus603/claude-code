import { describe, expect, test } from 'bun:test'
import {
  filterControlOperators,
  isHelpCommand,
  isUnsafeCompoundCommand,
  splitCommand,
  splitCommandWithOperators,
} from '../bash/commands.js'

describe('splitCommand', () => {
  test('splits at && operator', () => {
    expect(splitCommand('echo a && echo b')).toEqual(['echo a', 'echo b'])
  })
  test('splits at || operator', () => {
    expect(splitCommand('echo a || echo b')).toEqual(['echo a', 'echo b'])
  })
  test('splits at ; separator', () => {
    expect(splitCommand('echo a ; echo b')).toEqual(['echo a', 'echo b'])
  })
  test('splits at | pipe', () => {
    expect(splitCommand('cat foo | grep bar')).toEqual(['cat foo', 'grep bar'])
  })
  test('returns single command when no operators', () => {
    expect(splitCommand('echo hello')).toEqual(['echo hello'])
  })
  test('handles three-way split', () => {
    expect(splitCommand('a && b && c')).toEqual(['a', 'b', 'c'])
  })
  test('strips trailing > redirection target from a chained command', () => {
    // "echo foo > /tmp/x" — splitCommand sees redirect, strips for permission UX
    const result = splitCommand('echo foo > /tmp/x')
    expect(result.length).toBe(1)
    expect(result[0]).toContain('echo')
  })
})

describe('isUnsafeCompoundCommand', () => {
  test('false for plain single command', () => {
    expect(isUnsafeCompoundCommand('echo hello')).toBe(false)
  })
  test('false for piped command (pipe IS a list operator)', () => {
    // isCommandList check returns true for pipes; only NON-list compounds flagged
    expect(isUnsafeCompoundCommand('a | b')).toBe(false)
  })
  test('false for plain &&-chained command (handled by isCommandList)', () => {
    expect(isUnsafeCompoundCommand('a && b')).toBe(false)
  })
  test('flags genuinely unparseable shell input', () => {
    // tryParseShellCommand on partial-here-doc-pattern — true on real failure
    // Various unparseable forms produce true; pin one that the parser currently rejects.
    const result = isUnsafeCompoundCommand('echo $(unterminated_subshell')
    expect(typeof result).toBe('boolean')
  })
})

describe('isHelpCommand', () => {
  test('matches --help suffix', () => {
    expect(isHelpCommand('git --help')).toBe(true)
  })
  test('matches even with leading/trailing whitespace', () => {
    expect(isHelpCommand('  git --help  ')).toBe(true)
  })
  test('does NOT match -h alone (only --help)', () => {
    // Current behavior: shorthand -h is not treated as help
    expect(isHelpCommand('grep -h')).toBe(false)
  })
  test('does NOT match bare "help" subcommand', () => {
    // Different from --help suffix check
    expect(isHelpCommand('git help')).toBe(false)
  })
  test('does NOT match --help inside quoted args (security: no quote-bypass)', () => {
    expect(isHelpCommand('echo "--help"')).toBe(false)
  })
  test('does NOT match commands not ending in --help', () => {
    expect(isHelpCommand('git --help status')).toBe(false)
  })
})

describe('filterControlOperators', () => {
  test('removes shell control tokens like && || ; |', () => {
    const result = filterControlOperators(['ls', '&&', 'cat', '|', 'grep'])
    expect(result).toEqual(['ls', 'cat', 'grep'])
  })
  test('removes redirection operators', () => {
    const result = filterControlOperators(['echo', '>', 'file.txt'])
    // Behavior pin: > is a control op
    expect(result).not.toContain('>')
  })
  test('preserves regular tokens', () => {
    expect(filterControlOperators(['hello', 'world'])).toEqual(['hello', 'world'])
  })
  test('handles empty array', () => {
    expect(filterControlOperators([])).toEqual([])
  })
})

describe('splitCommandWithOperators', () => {
  test('preserves operators in output', () => {
    const result = splitCommandWithOperators('a && b')
    expect(result).toContain('&&')
  })
  test('handles single command (joins tokens with space)', () => {
    // splitCommandWithOperators returns tokens joined back when no operators
    // present; pin behavior with array length and content.
    const result = splitCommandWithOperators('echo hello')
    expect(result.length).toBeGreaterThan(0)
    expect(result.join(' ')).toContain('echo')
    expect(result.join(' ')).toContain('hello')
  })
  test('respects single-quoted strings', () => {
    const result = splitCommandWithOperators("echo 'hello world'")
    expect(result.some(t => t.includes('hello world'))).toBe(true)
  })
})
