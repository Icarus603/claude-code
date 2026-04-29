import { describe, expect, test } from 'bun:test'
import {
  hasWildcards,
  matchWildcardPattern,
  parsePermissionRule,
} from '../shellRuleMatching.js'

// ─── Probe hasWildcards backslash counting ──────────────────────────────

describe('hasWildcards — backslash counting precision', () => {
  test('zero backslashes (plain *) → unescaped → true', () => {
    expect(hasWildcards('foo *')).toBe(true)
  })

  test('one backslash (\\*) → escaped → false', () => {
    expect(hasWildcards('foo \\*')).toBe(false)
  })

  test('two backslashes (\\\\*) → escaped backslash + unescaped * → true', () => {
    expect(hasWildcards('foo \\\\*')).toBe(true)
  })

  test('three backslashes (\\\\\\*) → escaped backslash + escaped * → false', () => {
    expect(hasWildcards('foo \\\\\\*')).toBe(false)
  })

  test('four backslashes (\\\\\\\\*) → two escaped backslashes + unescaped * → true', () => {
    expect(hasWildcards('foo \\\\\\\\*')).toBe(true)
  })

  test('multiple wildcards — only one needs to be unescaped', () => {
    // Pattern: '\* foo *' — first * is escaped, second is not.
    expect(hasWildcards('\\* foo *')).toBe(true)
  })

  test('all wildcards escaped → false', () => {
    expect(hasWildcards('\\* \\*')).toBe(false)
  })

  test('legacy ":*" wins even if other * present in pattern', () => {
    // The function checks `endsWith(':*')` FIRST. Anything before that
    // is ignored — even if the pattern has unescaped * earlier.
    // CRITICAL: this rule prevents the legacy "git commit:*" form from
    // accidentally being interpreted as wildcard syntax.
    expect(hasWildcards('git commit:*')).toBe(false)
    expect(hasWildcards('foo * bar:*')).toBe(false)
  })

  test('asterisk at end without space prefix', () => {
    // 'foo*' (no space) — still has unescaped *.
    expect(hasWildcards('foo*')).toBe(true)
  })
})

// ─── Probe matchWildcardPattern edge cases ──────────────────────────────

describe('matchWildcardPattern — multiline / heredoc commands', () => {
  test('wildcard matches commands with embedded newlines (dotAll)', () => {
    // The 's' (dotAll) flag is critical for matching commands that splitCommand
    // returned with embedded newlines (heredoc content).
    expect(
      matchWildcardPattern(
        'cat *',
        'cat <<EOF\nline1\nline2\nEOF',
      ),
    ).toBe(true)
  })

  test('plain "." (any char) within wildcard → matches newline (dotAll)', () => {
    // Any '.' in the regex matches \n with dotAll flag.
    expect(matchWildcardPattern('echo *', 'echo line1\nline2')).toBe(true)
  })
})

describe('matchWildcardPattern — escaped wildcards in middle', () => {
  test('"echo \\* foo" matches literal "echo * foo"', () => {
    expect(matchWildcardPattern('echo \\* foo', 'echo * foo')).toBe(true)
  })

  test('"echo \\* foo" does NOT match "echo X foo"', () => {
    expect(matchWildcardPattern('echo \\* foo', 'echo X foo')).toBe(false)
  })

  test('"\\\\*" (escaped backslash + unescaped wildcard) matches "\\anything"', () => {
    expect(matchWildcardPattern('\\\\*', '\\anything')).toBe(true)
    expect(matchWildcardPattern('\\\\*', '\\')).toBe(true)
  })
})

describe('matchWildcardPattern — trailing-wildcard space-optionality', () => {
  // The "endsWith(' .*') && unescapedStarCount === 1" branch makes
  // `git *` match both `git add` AND bare `git`. Documents this load-bearing
  // ergonomic.

  test('"git *" matches bare "git"', () => {
    expect(matchWildcardPattern('git *', 'git')).toBe(true)
  })

  test('"git *" matches "git add"', () => {
    expect(matchWildcardPattern('git *', 'git add')).toBe(true)
  })

  test('"git *" matches "git add foo"', () => {
    expect(matchWildcardPattern('git *', 'git add foo')).toBe(true)
  })

  test('"git *" does NOT match "git2"', () => {
    // The optional " ?args" only kicks in if the rest is space-separated.
    expect(matchWildcardPattern('git *', 'git2')).toBe(false)
  })

  test('"git *" does NOT match "gitlab" (substring)', () => {
    expect(matchWildcardPattern('git *', 'gitlab')).toBe(false)
  })

  test('multi-wildcard pattern does NOT get the optional-suffix treatment', () => {
    // CRITICAL: '* run *' would incorrectly match 'npm run' if the trailing
    // space-wildcard were optional. The unescapedStarCount === 1 guard
    // prevents this.
    expect(matchWildcardPattern('* run *', 'npm run')).toBe(false)
    expect(matchWildcardPattern('* run *', 'npm run build')).toBe(true)
  })

  test('escaped trailing wildcard does NOT trigger optional suffix', () => {
    // Pattern 'git \*' has zero unescaped wildcards. The optional-suffix
    // logic does NOT apply — pattern matches 'git *' literally.
    expect(matchWildcardPattern('git \\*', 'git')).toBe(false)
    expect(matchWildcardPattern('git \\*', 'git *')).toBe(true)
  })
})

describe('matchWildcardPattern — regex special character escaping', () => {
  test('parens escaped — "(hello)" matches literal "(hello)" only', () => {
    expect(matchWildcardPattern('echo (hello)', 'echo (hello)')).toBe(true)
    expect(matchWildcardPattern('echo (hello)', 'echo hello')).toBe(false)
  })

  test('plus sign escaped — "a+" matches literal "a+"', () => {
    expect(matchWildcardPattern('echo a+', 'echo a+')).toBe(true)
    expect(matchWildcardPattern('echo a+', 'echo aaa')).toBe(false)
  })

  test('question mark escaped — "?" matches literal "?"', () => {
    expect(matchWildcardPattern('echo ?', 'echo ?')).toBe(true)
    expect(matchWildcardPattern('echo ?', 'echo a')).toBe(false)
  })

  test('dollar sign escaped — "$VAR" matches literal "$VAR"', () => {
    expect(matchWildcardPattern('echo $VAR', 'echo $VAR')).toBe(true)
  })

  test('square brackets escaped — "[abc]" is literal, not character class', () => {
    expect(matchWildcardPattern('echo [abc]', 'echo [abc]')).toBe(true)
    expect(matchWildcardPattern('echo [abc]', 'echo a')).toBe(false)
  })

  test('caret/dollar anchors escaped — pattern "^foo$" is literal', () => {
    expect(matchWildcardPattern('echo ^foo$', 'echo ^foo$')).toBe(true)
  })

  test('curly brace escaped — "{1,3}" is literal', () => {
    expect(matchWildcardPattern('echo {1,3}', 'echo {1,3}')).toBe(true)
  })

  test('pipe escaped — "a|b" is literal alt syntax escaped', () => {
    expect(matchWildcardPattern('echo a|b', 'echo a|b')).toBe(true)
    expect(matchWildcardPattern('echo a|b', 'echo a')).toBe(false)
    expect(matchWildcardPattern('echo a|b', 'echo b')).toBe(false)
  })

  test('single-quote escaped', () => {
    expect(matchWildcardPattern("echo 'hi'", "echo 'hi'")).toBe(true)
  })

  test('double-quote escaped', () => {
    expect(matchWildcardPattern('echo "hi"', 'echo "hi"')).toBe(true)
  })
})

describe('matchWildcardPattern — case insensitivity', () => {
  test('case-insensitive flag matches mixed case', () => {
    expect(matchWildcardPattern('GIT *', 'git add', true)).toBe(true)
  })

  test('case-insensitive flag false → matches case-sensitive', () => {
    expect(matchWildcardPattern('GIT *', 'git add', false)).toBe(false)
  })

  test('case-insensitive flag false by default', () => {
    expect(matchWildcardPattern('GIT *', 'git add')).toBe(false)
  })

  test('case-insensitive matches preserved escapes', () => {
    expect(matchWildcardPattern('ECHO \\*', 'echo *', true)).toBe(true)
  })
})

describe('matchWildcardPattern — full-string match (anchored)', () => {
  // Pattern is wrapped in ^...$. Wildcards must cover the FULL command.

  test('pattern without wildcard requires exact full-string match', () => {
    expect(matchWildcardPattern('npm install', 'npm install')).toBe(true)
    expect(matchWildcardPattern('npm install', 'npm install foo')).toBe(false)
    expect(matchWildcardPattern('npm install', 'sudo npm install')).toBe(false)
  })

  test('partial substring is NOT a match', () => {
    expect(matchWildcardPattern('git', 'git add')).toBe(false)
    expect(matchWildcardPattern('git add', 'git add foo')).toBe(false)
  })
})

describe('matchWildcardPattern — empty / whitespace edge', () => {
  test('empty pattern matches empty command', () => {
    expect(matchWildcardPattern('', '')).toBe(true)
  })

  test('empty pattern does NOT match non-empty command', () => {
    expect(matchWildcardPattern('', 'foo')).toBe(false)
  })

  test('"*" pattern matches anything', () => {
    expect(matchWildcardPattern('*', '')).toBe(true)
    expect(matchWildcardPattern('*', 'anything')).toBe(true)
    expect(matchWildcardPattern('*', 'with spaces')).toBe(true)
  })

  test('pattern with leading/trailing whitespace is trimmed', () => {
    // The function calls `pattern.trim()` first.
    expect(matchWildcardPattern('  git *  ', 'git add')).toBe(true)
    expect(matchWildcardPattern('  git *  ', 'git')).toBe(true)
  })
})

// ─── Probe parsePermissionRule branch ordering ──────────────────────────

describe('parsePermissionRule — branch precedence', () => {
  test('legacy ":*" wins over wildcard branch', () => {
    // 'foo:*' is legacy prefix even though it contains *.
    const r = parsePermissionRule('foo:*')
    expect(r.type).toBe('prefix')
    expect(r).toEqual({ type: 'prefix', prefix: 'foo' })
  })

  test('mixed ":*" with leading wildcard — STILL prefix (legacy precedence)', () => {
    // 'a*:*' — endsWith(':*') wins. The * earlier is included in the
    // "prefix" content. This documents the legacy-wins behavior so
    // future refactors don't accidentally flip the precedence.
    const r = parsePermissionRule('a*:*')
    expect(r.type).toBe('prefix')
    expect((r as { prefix: string }).prefix).toBe('a*')
  })

  test('escaped wildcard is exact, not wildcard', () => {
    expect(parsePermissionRule('echo \\*')).toEqual({
      type: 'exact',
      command: 'echo \\*',
    })
  })

  test('plain ":" (no asterisk) is exact, not prefix', () => {
    // 'foo:' does NOT end with ':*' → exact.
    expect(parsePermissionRule('foo:')).toEqual({
      type: 'exact',
      command: 'foo:',
    })
  })
})
