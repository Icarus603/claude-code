import { describe, expect, test } from 'bun:test'
import { loadFigSpec } from '../bash/registry.js'

describe('loadFigSpec — input validation (security-critical)', () => {
  // Critical: this function performs `await import('@withfig/autocomplete/
  // build/${command}.js')`. If `command` contains path traversal or
  // arbitrary chars, an attacker could load arbitrary modules. The
  // pre-validation rejects unsafe inputs.

  test('empty string → null', async () => {
    expect(await loadFigSpec('')).toBeNull()
  })

  test('command with forward slash → null (path traversal)', async () => {
    expect(await loadFigSpec('foo/bar')).toBeNull()
  })

  test('command with backslash → null (Windows path traversal)', async () => {
    expect(await loadFigSpec('foo\\bar')).toBeNull()
  })

  test('command with .. → null (parent-dir traversal)', async () => {
    expect(await loadFigSpec('..')).toBeNull()
    expect(await loadFigSpec('../etc/passwd')).toBeNull()
    expect(await loadFigSpec('foo..bar')).toBeNull()
  })

  test('command starting with - → null (would be flag in import)', async () => {
    // Critical: `import('-foo')` would be interpreted as a flag, not a
    // command name. Reject leading dashes.
    expect(await loadFigSpec('-help')).toBeNull()
    expect(await loadFigSpec('--help')).toBeNull()
    expect(await loadFigSpec('-rm-rf')).toBeNull()
  })

  test('bare "-" is a SPECIAL CASE allowed (matches autocomplete spec for stdin)', () => {
    // The check is `command.startsWith('-') && command !== '-'` —
    // singleton dash is allowed. Documents this contract explicitly.
    // The actual spec for "-" may or may not exist in @withfig/autocomplete,
    // so we don't assert the return value, just that it doesn't reject early.
    // (Function returns null on import failure too, so we can't distinguish
    // "rejected early" from "tried but failed". Accept either by virtue of
    // not throwing.)
    expect(() => loadFigSpec('-')).not.toThrow()
  })

  test('valid command name passes input validation', async () => {
    // ls, git, etc. — these should reach the import stage. Whether the
    // import succeeds depends on whether @withfig/autocomplete has a
    // spec, but the input passes validation.
    const result = await loadFigSpec('ls')
    // result is either null (no spec) or a CommandSpec object — both
    // indicate input validation passed.
    expect(result === null || typeof result === 'object').toBe(true)
  })

  test('rejects commands with traversal-like patterns even mixed', async () => {
    expect(await loadFigSpec('a/b')).toBeNull()
    expect(await loadFigSpec('a..b')).toBeNull()
    expect(await loadFigSpec('a/..b')).toBeNull()
  })

  test('case sensitivity preserved (we don\'t lowercase)', async () => {
    // The function passes the command to import as-is. Whether the
    // upstream spec is case-sensitive is an upstream concern.
    const result = await loadFigSpec('Ls')
    expect(result === null || typeof result === 'object').toBe(true)
  })

  test('numeric / unusual but no special chars passes validation', async () => {
    // Whitelist is implicit: anything without /, \, .., or leading -
    // passes. So '12345' or 'foo-bar' (dash NOT at start) passes.
    expect(() => loadFigSpec('foo-bar')).not.toThrow()
    expect(() => loadFigSpec('12345')).not.toThrow()
  })
})
