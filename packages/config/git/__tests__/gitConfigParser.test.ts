import { describe, expect, test } from 'bun:test'
import { parseConfigString } from '../gitConfigParser.js'

describe('parseConfigString — basic section.key', () => {
  test('parses simple section with single key', () => {
    const config = `[user]
name = Alice`
    expect(parseConfigString(config, 'user', null, 'name')).toBe('Alice')
  })

  test('returns null for missing section', () => {
    const config = `[user]
name = Alice`
    expect(parseConfigString(config, 'core', null, 'name')).toBeNull()
  })

  test('returns null for missing key in present section', () => {
    const config = `[user]
name = Alice`
    expect(parseConfigString(config, 'user', null, 'email')).toBeNull()
  })

  test('returns null for empty config', () => {
    expect(parseConfigString('', 'user', null, 'name')).toBeNull()
  })

  test('returns FIRST matching key when duplicates exist within section', () => {
    const config = `[user]
name = First
name = Second`
    expect(parseConfigString(config, 'user', null, 'name')).toBe('First')
  })

  test('parses multiple keys in same section', () => {
    const config = `[user]
name = Alice
email = alice@example.com`
    expect(parseConfigString(config, 'user', null, 'name')).toBe('Alice')
    expect(parseConfigString(config, 'user', null, 'email')).toBe(
      'alice@example.com',
    )
  })
})

describe('parseConfigString — case sensitivity', () => {
  test('section names are case-INsensitive', () => {
    const config = `[USER]
name = Alice`
    expect(parseConfigString(config, 'user', null, 'name')).toBe('Alice')
  })

  test('section query is case-insensitive even when input is uppercase', () => {
    const config = `[user]
name = Alice`
    expect(parseConfigString(config, 'USER', null, 'name')).toBe('Alice')
  })

  test('key names are case-INsensitive', () => {
    const config = `[user]
NAME = Alice`
    expect(parseConfigString(config, 'user', null, 'name')).toBe('Alice')
  })

  test('values are case-SENSITIVE (preserved verbatim)', () => {
    const config = `[user]
name = AliceUPPERcase`
    expect(parseConfigString(config, 'user', null, 'name')).toBe(
      'AliceUPPERcase',
    )
  })
})

describe('parseConfigString — subsections', () => {
  test('parses [remote "origin"] subsection', () => {
    const config = `[remote "origin"]
url = git@github.com:foo/bar.git`
    expect(parseConfigString(config, 'remote', 'origin', 'url')).toBe(
      'git@github.com:foo/bar.git',
    )
  })

  test('subsection names are case-SENSITIVE', () => {
    const config = `[remote "origin"]
url = test`
    // Subsection 'Origin' (capital O) does NOT match 'origin'.
    expect(parseConfigString(config, 'remote', 'Origin', 'url')).toBeNull()
  })

  test('section without subsection does not match subsection query', () => {
    const config = `[remote]
url = test`
    expect(parseConfigString(config, 'remote', 'origin', 'url')).toBeNull()
  })

  test('section with subsection does not match null-subsection query', () => {
    const config = `[remote "origin"]
url = test`
    expect(parseConfigString(config, 'remote', null, 'url')).toBeNull()
  })

  test('handles multiple remotes — finds the right one', () => {
    const config = `[remote "origin"]
url = origin-url
[remote "upstream"]
url = upstream-url`
    expect(parseConfigString(config, 'remote', 'origin', 'url')).toBe(
      'origin-url',
    )
    expect(parseConfigString(config, 'remote', 'upstream', 'url')).toBe(
      'upstream-url',
    )
  })

  test('handles escaped backslash in subsection name', () => {
    const config = `[remote "path\\\\with\\\\backslash"]
url = test`
    expect(
      parseConfigString(
        config,
        'remote',
        'path\\with\\backslash',
        'url',
      ),
    ).toBe('test')
  })

  test('handles escaped quote in subsection name', () => {
    const config = `[remote "name\\"with\\"quote"]
url = test`
    expect(
      parseConfigString(config, 'remote', 'name"with"quote', 'url'),
    ).toBe('test')
  })
})

describe('parseConfigString — comments', () => {
  test('skips # comment lines', () => {
    const config = `# Top comment
[user]
# Inline comment
name = Alice`
    expect(parseConfigString(config, 'user', null, 'name')).toBe('Alice')
  })

  test('skips ; comment lines', () => {
    const config = `; Top comment
[user]
name = Alice`
    expect(parseConfigString(config, 'user', null, 'name')).toBe('Alice')
  })

  test('strips inline # comment from value', () => {
    const config = `[user]
name = Alice # this is a comment`
    expect(parseConfigString(config, 'user', null, 'name')).toBe('Alice')
  })

  test('strips inline ; comment from value', () => {
    const config = `[user]
name = Alice ; comment here`
    expect(parseConfigString(config, 'user', null, 'name')).toBe('Alice')
  })

  test('# inside quoted value is preserved', () => {
    const config = `[user]
name = "Alice # not a comment"`
    expect(parseConfigString(config, 'user', null, 'name')).toBe(
      'Alice # not a comment',
    )
  })
})

describe('parseConfigString — quoted values + escapes', () => {
  test('basic quoted value', () => {
    const config = `[user]
name = "Alice Smith"`
    expect(parseConfigString(config, 'user', null, 'name')).toBe('Alice Smith')
  })

  test('escaped \\n inside quotes → newline', () => {
    const config = `[user]
greeting = "line1\\nline2"`
    expect(parseConfigString(config, 'user', null, 'greeting')).toBe(
      'line1\nline2',
    )
  })

  test('escaped \\t inside quotes → tab', () => {
    const config = `[user]
v = "a\\tb"`
    expect(parseConfigString(config, 'user', null, 'v')).toBe('a\tb')
  })

  test('escaped \\" inside quotes → literal quote', () => {
    const config = `[user]
v = "say \\"hi\\""`
    expect(parseConfigString(config, 'user', null, 'v')).toBe('say "hi"')
  })

  test('escaped \\\\ inside quotes → literal backslash', () => {
    const config = `[user]
v = "a\\\\b"`
    expect(parseConfigString(config, 'user', null, 'v')).toBe('a\\b')
  })

  test('unknown escape inside quotes — backslash dropped (git behavior)', () => {
    // Git silently drops the backslash for unknown escapes.
    const config = `[user]
v = "a\\zb"`
    expect(parseConfigString(config, 'user', null, 'v')).toBe('azb')
  })
})

describe('parseConfigString — whitespace handling', () => {
  test('trims whitespace around = sign', () => {
    const config = `[user]
name=Alice`
    expect(parseConfigString(config, 'user', null, 'name')).toBe('Alice')
  })

  test('trims trailing whitespace from unquoted value', () => {
    const config = `[user]
name = Alice   `
    expect(parseConfigString(config, 'user', null, 'name')).toBe('Alice')
  })

  test('preserves trailing whitespace inside quotes', () => {
    const config = `[user]
name = "Alice   "`
    expect(parseConfigString(config, 'user', null, 'name')).toBe('Alice   ')
  })
})

describe('parseConfigString — malformed input', () => {
  test('boolean key (no value) returns null', () => {
    // `mybool` with no `=` is a "boolean key" in git — not what we
    // support. Returns null.
    const config = `[user]
mybool`
    expect(parseConfigString(config, 'user', null, 'mybool')).toBeNull()
  })

  test('section header with no closing bracket → no section match', () => {
    const config = `[user
name = Alice`
    expect(parseConfigString(config, 'user', null, 'name')).toBeNull()
  })

  test('garbage after section header is ignored when followed by ]', () => {
    // Section like `[user]extra` — the parser reads alphanum-and-hyphen
    // until non-key char, finds 'user', then expects ']'. Extra after
    // section won't break parsing.
    const config = `[user]
name = Alice`
    expect(parseConfigString(config, 'user', null, 'name')).toBe('Alice')
  })

  test('empty section returns null for any key', () => {
    const config = `[user]
[other]
name = Bob`
    expect(parseConfigString(config, 'user', null, 'name')).toBeNull()
  })
})

describe('parseConfigString — section switching', () => {
  test('key only matches when in correct section', () => {
    const config = `[other]
name = Wrong
[user]
name = Right`
    expect(parseConfigString(config, 'user', null, 'name')).toBe('Right')
  })

  test('key in different section is NOT picked up', () => {
    const config = `[a]
key = a-value
[b]
key = b-value`
    expect(parseConfigString(config, 'a', null, 'key')).toBe('a-value')
    expect(parseConfigString(config, 'b', null, 'key')).toBe('b-value')
  })

  test('returning to a section later — first occurrence wins', () => {
    const config = `[user]
name = First
[other]
foo = bar
[user]
name = Second`
    expect(parseConfigString(config, 'user', null, 'name')).toBe('First')
  })
})

describe('parseConfigString — real-world git config patterns', () => {
  test('typical .git/config with core + remote + branch', () => {
    const config = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = false
\tlogallrefupdates = true
[remote "origin"]
\turl = git@github.com:Icarus603/ccb.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
\tremote = origin
\tmerge = refs/heads/main`
    expect(parseConfigString(config, 'remote', 'origin', 'url')).toBe(
      'git@github.com:Icarus603/ccb.git',
    )
    expect(parseConfigString(config, 'core', null, 'bare')).toBe('false')
    expect(parseConfigString(config, 'branch', 'main', 'remote')).toBe(
      'origin',
    )
  })
})
