import { describe, expect, test } from 'bun:test'
import { formatShellPrefixCommand } from '../bash/shellPrefix.js'

// shell-quote `quote()` only quotes strings that need it (contain spaces,
// metachars, etc.). Simple alphanumeric strings pass through unquoted.
// Tests below reflect that behavior.

describe('formatShellPrefixCommand — simple shell name (no flags)', () => {
  test('"bash" + simple command — both unquoted (no spaces/metachars)', () => {
    expect(formatShellPrefixCommand('bash', 'ls')).toBe('bash ls')
  })

  test('"sh" + command containing spaces — command quoted', () => {
    expect(formatShellPrefixCommand('sh', 'echo hi')).toBe("sh 'echo hi'")
  })

  test('"zsh" + command containing spaces', () => {
    // The whole "echo hello world" becomes a single quoted argument.
    expect(formatShellPrefixCommand('zsh', 'echo hello world')).toBe(
      "zsh 'echo hello world'",
    )
  })
})

describe('formatShellPrefixCommand — shell with -c flag', () => {
  test('"bash -c" splits at " -" boundary', () => {
    // The function looks for " -" — the space-before-dash separator.
    // It splits the prefix into the executable + the rest of the args.
    expect(formatShellPrefixCommand('bash -c', 'ls')).toBe('bash -c ls')
  })

  test('"/usr/bin/bash -c" — absolute path (slashes are not metachars)', () => {
    expect(formatShellPrefixCommand('/usr/bin/bash -c', 'ls')).toBe(
      '/usr/bin/bash -c ls',
    )
  })

  test('"sh -c" + command with $ variable — command quoted', () => {
    expect(formatShellPrefixCommand('sh -c', 'echo $HOME')).toBe(
      "sh -c 'echo $HOME'",
    )
  })

  test('windows path with bash.exe + -c', () => {
    // The exec-path quoting uses shell-quote's `quote()` which handles
    // backslashes — a critical Windows-compat path.
    const result = formatShellPrefixCommand(
      'C:\\Program Files\\Git\\bin\\bash.exe -c',
      'ls',
    )
    expect(result).toContain('-c')
    expect(result).toContain('ls')
    expect(result).toContain('bash.exe')
  })
})

describe('formatShellPrefixCommand — boundary detection', () => {
  test('multiple " -X" instances — splits at LAST one (greedy)', () => {
    // The function uses `lastIndexOf(' -')`. So if a path contains ` -`
    // (e.g. "my-shell -opt -c"), the LAST one wins.
    // Documents the lastIndexOf semantics: split keeps "my-shell -opt"
    // as the executable and "-c" as the rest. The exec contains a space,
    // so it gets quoted.
    expect(formatShellPrefixCommand('my-shell -opt -c', 'cmd')).toBe(
      "'my-shell -opt' -c cmd",
    )
  })

  test('flag at the very start ("-bash") — no split (spaceBeforeDash <= 0)', () => {
    // The condition is `spaceBeforeDash > 0`. lastIndexOf(' -') in '-bash'
    // returns -1 → falls through to the no-split branch.
    expect(formatShellPrefixCommand('-bash', 'cmd')).toBe('-bash cmd')
  })

  test('hyphen WITHIN executable name (no space) — no split', () => {
    // 'my-shell' contains a hyphen but no SPACE before it. lastIndexOf(' -')
    // returns -1 → no split, the whole prefix is treated as exec name.
    expect(formatShellPrefixCommand('my-shell', 'ls')).toBe('my-shell ls')
  })

  test('trailing space-dash — splits at " -"', () => {
    // "bash -" splits at the " -" giving exec="bash" and args="-".
    expect(formatShellPrefixCommand('bash -', 'cmd')).toBe('bash - cmd')
  })
})

describe('formatShellPrefixCommand — special characters in command', () => {
  test('command with single quotes — wrapped in double quotes', () => {
    // The `quote()` from shell-quote handles nested quotes by switching
    // to double-quote wrapping when single quotes are present.
    const result = formatShellPrefixCommand('bash', "echo 'hi'")
    expect(result).toBe(`bash "echo 'hi'"`)
  })

  test('command with double quotes', () => {
    const result = formatShellPrefixCommand('bash', 'echo "hi"')
    expect(result).toContain('bash')
    expect(result).toContain('echo')
  })

  test('command with shell metacharacters (|, &, ;, $)', () => {
    // The whole `command` is a single argument to shell -c, so it must
    // be quoted as one unit. The metachars don't get evaluated by the
    // outer shell (which sees them inside quotes).
    const result = formatShellPrefixCommand('bash -c', 'ls | grep foo')
    expect(result).toBe("bash -c 'ls | grep foo'")
  })

  test('empty command — quoted as empty string', () => {
    expect(formatShellPrefixCommand('bash', '')).toBe("bash ''")
  })

  test('command with newlines preserved', () => {
    // Multiline commands (common with bash heredocs) — the quote() must
    // produce a string that round-trips when shell parses it.
    const result = formatShellPrefixCommand('bash', 'line1\nline2')
    expect(result).toContain('line1')
    expect(result).toContain('line2')
  })
})

describe('formatShellPrefixCommand — empty / edge prefixes', () => {
  test('empty prefix — quoted as empty string', () => {
    expect(formatShellPrefixCommand('', 'cmd')).toBe("'' cmd")
  })

  test('whitespace-only prefix', () => {
    // ' ' has no -, so no split. shell-quote treats space-containing
    // strings as needing quotes.
    const result = formatShellPrefixCommand(' ', 'cmd')
    expect(result).toContain('cmd')
  })

  test('prefix that is ONLY a hyphen-flag (no shell name)', () => {
    // '-c' starts with hyphen, no space-before-dash → no split.
    expect(formatShellPrefixCommand('-c', 'cmd')).toBe('-c cmd')
  })
})

describe('formatShellPrefixCommand — common real-world prefixes', () => {
  test('"bash --login -c" — multiple flags, exec contains space', () => {
    // lastIndexOf(' -') finds the LAST " -" (the one before -c).
    // Splits as exec='bash --login', args='-c'.
    expect(formatShellPrefixCommand('bash --login -c', 'echo')).toBe(
      "'bash --login' -c echo",
    )
  })

  test('"sh --noprofile --norc -c" — three flags', () => {
    expect(formatShellPrefixCommand('sh --noprofile --norc -c', 'echo')).toBe(
      "'sh --noprofile --norc' -c echo",
    )
  })

  test('docker run wrapper — "docker run --rm bash -c"', () => {
    // Real wrapper case. The last " -" is before "-c" → exec is the
    // long "docker run --rm bash" string.
    expect(
      formatShellPrefixCommand('docker run --rm bash -c', 'ls'),
    ).toBe("'docker run --rm bash' -c ls")
  })
})
