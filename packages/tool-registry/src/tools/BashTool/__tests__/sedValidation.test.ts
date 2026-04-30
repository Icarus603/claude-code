/**
 * Tests for sed allowlist + denylist — the security-critical gate
 * that decides which sed commands BashTool runs without an extra
 * permission ask.
 *
 * Wrong allowlist = arbitrary command execution via sed `e` flag
 * (`sed 's/x/y/e'` runs the replacement as shell), or arbitrary
 * file write via sed `w` flag (`sed '/foo/w /etc/passwd'`).
 *
 * Wrong denylist = the allowlist's regex matchers may pass a
 * command that contains a hidden `w` / `e` / `W` / `E` operation.
 *
 * The functions here are pure (regex + shell-quote parser only —
 * no I/O, no host bindings).
 */
import { describe, expect, test } from 'bun:test'
import {
  extractSedExpressions,
  hasFileArgs,
  isLinePrintingCommand,
  isPrintCommand,
  sedCommandIsAllowedByAllowlist,
} from '../sedValidation.js'

describe('isPrintCommand — strict print-command allowlist', () => {
  test('p alone → true', () => {
    expect(isPrintCommand('p')).toBe(true)
  })

  test('Np (single line) → true', () => {
    expect(isPrintCommand('1p')).toBe(true)
    expect(isPrintCommand('999p')).toBe(true)
  })

  test('N,Mp (range) → true', () => {
    expect(isPrintCommand('1,5p')).toBe(true)
    expect(isPrintCommand('10,200p')).toBe(true)
  })

  test('empty string → false', () => {
    expect(isPrintCommand('')).toBe(false)
  })

  test('non-print commands → false', () => {
    expect(isPrintCommand('d')).toBe(false)
    expect(isPrintCommand('s/x/y/')).toBe(false)
    expect(isPrintCommand('w file')).toBe(false)
    expect(isPrintCommand('e cmd')).toBe(false)
  })

  test('print w/ trailing junk → false', () => {
    expect(isPrintCommand('1pw')).toBe(false)
    expect(isPrintCommand('1p file')).toBe(false)
  })

  test('regex address /foo/p → false (only digit addresses allowed)', () => {
    // Documented contract: STRICT allowlist, only `[N[,M]]?p`.
    expect(isPrintCommand('/foo/p')).toBe(false)
  })

  test('case-insensitive P → false (only lowercase)', () => {
    expect(isPrintCommand('P')).toBe(false)
  })

  test('whitespace inside → false', () => {
    expect(isPrintCommand('1 p')).toBe(false)
    expect(isPrintCommand('1, 5p')).toBe(false)
  })
})

describe('isLinePrintingCommand — Pattern 1', () => {
  test('sed -n 1p file → true', () => {
    expect(isLinePrintingCommand("sed -n '1p' file.txt", ['1p'])).toBe(true)
  })

  test('sed -n with range → true', () => {
    expect(
      isLinePrintingCommand("sed -n '1,10p' file.txt", ['1,10p']),
    ).toBe(true)
  })

  test('sed -n with semicolon-separated print commands → true', () => {
    // Documented contract: Pattern 1 allows `;` between print commands.
    expect(
      isLinePrintingCommand("sed -n '1p;2p;3p' file.txt", ['1p;2p;3p']),
    ).toBe(true)
  })

  test('sed without -n → false (Pattern 1 requires -n)', () => {
    expect(isLinePrintingCommand("sed '1p' file.txt", ['1p'])).toBe(false)
  })

  test('sed -n with substitution expression → false', () => {
    expect(
      isLinePrintingCommand("sed -n 's/x/y/' file.txt", ['s/x/y/']),
    ).toBe(false)
  })

  test('sed -n with no expressions → false', () => {
    expect(isLinePrintingCommand('sed -n file.txt', [])).toBe(false)
  })

  test('non-sed command → false', () => {
    expect(isLinePrintingCommand("cat file.txt", [])).toBe(false)
  })

  test('sed -n with disallowed flag → false', () => {
    // -i is NOT in Pattern 1's allowlist.
    expect(
      isLinePrintingCommand("sed -n -i '1p' file.txt", ['1p']),
    ).toBe(false)
  })

  test('combined flags -nE → true (extended regex + quiet)', () => {
    expect(
      isLinePrintingCommand("sed -nE '1p' file.txt", ['1p']),
    ).toBe(true)
  })

  test('combined flags -nx → false (x not in allowlist)', () => {
    expect(
      isLinePrintingCommand("sed -nx '1p' file.txt", ['1p']),
    ).toBe(false)
  })

  test('sed -n with delete command → false (only print allowed)', () => {
    expect(isLinePrintingCommand("sed -n '1d' file.txt", ['1d'])).toBe(false)
  })

  test('mixed valid+invalid in semicolon list → false', () => {
    // If ANY element in the ;-separated list is not a print command, reject.
    expect(
      isLinePrintingCommand("sed -n '1p;w /etc/passwd' file", [
        '1p;w /etc/passwd',
      ]),
    ).toBe(false)
  })
})

describe('extractSedExpressions — expression vs filename discrimination', () => {
  test('first positional after -i is expression', () => {
    expect(extractSedExpressions("sed -i 's/x/y/' f.txt")).toEqual([
      's/x/y/',
    ])
  })

  test('-e <expr> as separate args', () => {
    expect(extractSedExpressions("sed -e 's/x/y/' f.txt")).toEqual([
      's/x/y/',
    ])
  })

  test('multiple -e expressions: all extracted', () => {
    expect(
      extractSedExpressions("sed -e 's/a/b/' -e 's/c/d/' f.txt"),
    ).toEqual(['s/a/b/', 's/c/d/'])
  })

  test('--expression= long form', () => {
    expect(extractSedExpressions('sed --expression=s/x/y/ f.txt')).toEqual([
      's/x/y/',
    ])
  })

  test('-e= form (defense-in-depth)', () => {
    expect(extractSedExpressions('sed -e=s/x/y/ f.txt')).toEqual(['s/x/y/'])
  })

  test('non-sed command → empty array (not throw)', () => {
    expect(extractSedExpressions('cat foo')).toEqual([])
  })

  test('dangerous combined flags -ew throw', () => {
    // Documented contract: -ew (combined -e + write?) is paranoid-rejected.
    expect(() => extractSedExpressions("sed -ew 'foo' f.txt")).toThrow(
      'Dangerous flag combination',
    )
  })

  test('-we throw (any combo of e + w)', () => {
    expect(() => extractSedExpressions("sed -we 'foo' f.txt")).toThrow(
      'Dangerous flag combination',
    )
  })

  test('shell-quote tolerates unbalanced quotes (does NOT throw)', () => {
    // Documented surprise: shell-quote accepts unbalanced single quote as
    // a literal string. The downstream allowlist matchers then reject
    // such expressions if they don't match the strict s/x/y/ shape.
    expect(() => extractSedExpressions("sed -i 's/x/y/")).not.toThrow()
  })
})

describe('hasFileArgs — file-argument detection', () => {
  test('sed -i expr file → true', () => {
    expect(hasFileArgs("sed -i 's/x/y/' f.txt")).toBe(true)
  })

  test('sed -i expr → false (no file)', () => {
    expect(hasFileArgs("sed -i 's/x/y/'")).toBe(false)
  })

  test('sed -e expr (any non-flag arg after -e is file)', () => {
    // Documented contract: When -e was used, all non-flag args after are files.
    expect(hasFileArgs("sed -e 's/x/y/' f.txt")).toBe(true)
  })

  test('sed -e expr alone → false (no file)', () => {
    expect(hasFileArgs("sed -e 's/x/y/'")).toBe(false)
  })

  test('non-sed command → false', () => {
    expect(hasFileArgs('cat foo bar')).toBe(false)
  })

  test('positional only — first is expression, second is file', () => {
    expect(hasFileArgs("sed 's/x/y/' f.txt")).toBe(true)
  })

  test('positional only with one arg → false (just expression)', () => {
    expect(hasFileArgs("sed 's/x/y/'")).toBe(false)
  })
})

describe('sedCommandIsAllowedByAllowlist — read-only mode', () => {
  test('safe substitution s/x/y/ stdout-only → true', () => {
    expect(sedCommandIsAllowedByAllowlist("sed 's/x/y/'")).toBe(true)
  })

  test('safe substitution with file arg → false (writes file)', () => {
    // Without allowFileWrites, file args are rejected for substitutions.
    expect(sedCommandIsAllowedByAllowlist("sed 's/x/y/' f.txt")).toBe(false)
  })

  test('-i with file → false in read-only mode', () => {
    expect(sedCommandIsAllowedByAllowlist("sed -i 's/x/y/' f.txt")).toBe(false)
  })

  test('Pattern 1 print command with file → true', () => {
    expect(sedCommandIsAllowedByAllowlist("sed -n '1,10p' f.txt")).toBe(true)
  })

  test('write flag s/x/y/w blocked', () => {
    // The 'w' flag in substitution writes pattern space to a file.
    expect(sedCommandIsAllowedByAllowlist("sed 's/x/y/w out.txt'")).toBe(false)
  })

  test('execute flag s/x/y/e blocked', () => {
    // The 'e' flag executes pattern space as shell command.
    expect(sedCommandIsAllowedByAllowlist("sed 's/x/y/e'")).toBe(false)
  })

  test('non-`/` delimiter → false', () => {
    expect(sedCommandIsAllowedByAllowlist("sed 's#x#y#'")).toBe(false)
  })

  test('Pattern 2 with semicolon → false (not allowed in substitution)', () => {
    expect(
      sedCommandIsAllowedByAllowlist("sed 's/x/y/;s/a/b/'"),
    ).toBe(false)
  })

  test('w command at start (write) blocked', () => {
    expect(sedCommandIsAllowedByAllowlist("sed -n 'w /etc/passwd' f")).toBe(
      false,
    )
  })

  test('curly-brace block blocked', () => {
    expect(sedCommandIsAllowedByAllowlist("sed -n '{1p;2p}' f")).toBe(false)
  })

  test('non-ASCII char in expression blocked (homoglyph defense)', () => {
    // ｗ is fullwidth latin small w — could fool ASCII-only matchers.
    expect(sedCommandIsAllowedByAllowlist("sed 's/x/y/ｗ'")).toBe(false)
  })

  test('comment in expression blocked', () => {
    expect(sedCommandIsAllowedByAllowlist("sed -n '1p;#comment' f")).toBe(
      false,
    )
  })

  test('negation operator blocked', () => {
    expect(sedCommandIsAllowedByAllowlist("sed -n '!1p' f")).toBe(false)
  })

  test('y (transliterate) command with w in chars blocked', () => {
    // Paranoid: y commands containing w/W/e/E anywhere are rejected.
    expect(sedCommandIsAllowedByAllowlist("sed 'y/abc/wbc/'")).toBe(false)
  })
})

describe('sedCommandIsAllowedByAllowlist — allowFileWrites=true (acceptEdits mode)', () => {
  test('-i s/x/y/ file → true', () => {
    expect(
      sedCommandIsAllowedByAllowlist("sed -i 's/x/y/' f.txt", {
        allowFileWrites: true,
      }),
    ).toBe(true)
  })

  test('without -i, file arg in substitution → still acceptable (writes implicit)', () => {
    // Both file args + -i are gated by allowFileWrites in Pattern 2.
    expect(
      sedCommandIsAllowedByAllowlist("sed 's/x/y/' f.txt", {
        allowFileWrites: true,
      }),
    ).toBe(true)
  })

  test('-i with execute flag still blocked', () => {
    expect(
      sedCommandIsAllowedByAllowlist("sed -i 's/x/y/e' f.txt", {
        allowFileWrites: true,
      }),
    ).toBe(false)
  })

  test('-i with write flag still blocked', () => {
    expect(
      sedCommandIsAllowedByAllowlist("sed -i 's/x/y/w out' f.txt", {
        allowFileWrites: true,
      }),
    ).toBe(false)
  })

  test('Pattern 1 line-printing NOT allowed in allowFileWrites mode (only Pattern 2 substitution)', () => {
    // Documented contract: when allowFileWrites=true, Pattern 1 (line-print)
    // is not exercised — only substitution is checked.
    // sed -n '1p' f.txt: under allowFileWrites we only check substitution,
    // so the substitution check fails (1p is not a substitution).
    expect(
      sedCommandIsAllowedByAllowlist("sed -n '1,10p' f.txt", {
        allowFileWrites: true,
      }),
    ).toBe(false)
  })
})

describe('sedCommandIsAllowedByAllowlist — denylist defense-in-depth', () => {
  test('escaped slash with w trick blocked', () => {
    // /\/path/w would be a write target via escaped slashes.
    expect(
      sedCommandIsAllowedByAllowlist("sed -n '/\\/path/w out.txt' f"),
    ).toBe(false)
  })

  test('GNU step address (1~2) blocked', () => {
    expect(sedCommandIsAllowedByAllowlist("sed -n '1~2p' f")).toBe(false)
  })

  test('newline in expression blocked', () => {
    expect(sedCommandIsAllowedByAllowlist("sed 's/x\\\ny/z/'")).toBe(false)
  })
})
