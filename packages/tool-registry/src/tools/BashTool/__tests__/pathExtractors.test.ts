/**
 * Tests for PATH_EXTRACTORS + stripWrappersFromArgv — pure helpers
 * that decide which command arguments are file paths (so the
 * BashTool path validator knows what to check) and strip safe
 * wrappers (timeout / nice / stdbuf / env / time / nohup) before
 * the path validation gate inspects the base command.
 *
 * Wrong extraction: a path slips past validation → write to
 * /etc/passwd or read .ssh/* without prompting.
 *
 * Wrong wrapper stripping: `timeout 10 rm -rf /outside` keeps
 * baseCmd='timeout' → not in SUPPORTED_PATH_COMMANDS → passthrough
 * → wrapped paths never validated. (PR #21503 round 3 fix.)
 */
import { describe, expect, test } from 'bun:test'
import {
  PATH_EXTRACTORS,
  stripWrappersFromArgv,
} from '../pathValidation.js'

describe('PATH_EXTRACTORS — cd', () => {
  test('no args → homedir-like default (single element)', () => {
    const r = PATH_EXTRACTORS.cd([])
    expect(r).toHaveLength(1)
    // The default is os.homedir() — just check it's a non-empty string.
    expect(typeof r[0]).toBe('string')
    expect(r[0]!.length).toBeGreaterThan(0)
  })

  test('single arg → single path', () => {
    expect(PATH_EXTRACTORS.cd(['foo'])).toEqual(['foo'])
  })

  test('multiple args joined with space (cd accepts single path argv)', () => {
    // Documented quirk: cd 'My Documents' was already split by shell-quote
    // into 'My' + 'Documents'; rejoin so path validation sees the original.
    expect(PATH_EXTRACTORS.cd(['My', 'Documents'])).toEqual(['My Documents'])
  })
})

describe('PATH_EXTRACTORS — ls', () => {
  test('no args → ["."]', () => {
    expect(PATH_EXTRACTORS.ls([])).toEqual(['.'])
  })

  test('flags only → ["."]', () => {
    expect(PATH_EXTRACTORS.ls(['-la'])).toEqual(['.'])
  })

  test('paths only → returned as-is', () => {
    expect(PATH_EXTRACTORS.ls(['foo', 'bar'])).toEqual(['foo', 'bar'])
  })

  test('flags + paths → only paths', () => {
    expect(PATH_EXTRACTORS.ls(['-la', 'foo', '-h', 'bar'])).toEqual([
      'foo',
      'bar',
    ])
  })

  test('-- end-of-options: subsequent args are paths even with leading -', () => {
    // Documented contract: SECURITY — ls -- -file makes -file a positional
    // path. Naive .startsWith('-') filtering would drop it and skip
    // validation. Validator must see -file.
    expect(PATH_EXTRACTORS.ls(['--', '-trickyfile'])).toEqual(['-trickyfile'])
  })
})

describe('PATH_EXTRACTORS — find', () => {
  test('no args → ["."]', () => {
    expect(PATH_EXTRACTORS.find([])).toEqual(['.'])
  })

  test('starting paths before predicates extracted', () => {
    // find /foo /bar -name '*.ts'
    expect(
      PATH_EXTRACTORS.find(['/foo', '/bar', '-name', '*.ts']),
    ).toEqual(['/foo', '/bar'])
  })

  test('global flags -H/-L/-P do not stop path collection', () => {
    expect(
      PATH_EXTRACTORS.find(['-H', '/foo', '-name', 'x']),
    ).toEqual(['/foo'])
    expect(
      PATH_EXTRACTORS.find(['-L', '-P', '/bar']),
    ).toEqual(['/bar'])
  })

  test('-newer NAME extracts NAME as a path argument', () => {
    expect(
      PATH_EXTRACTORS.find(['/x', '-newer', '/ref-file']),
    ).toEqual(['/x', '/ref-file'])
  })

  test('-path PATTERN extracts PATTERN', () => {
    expect(
      PATH_EXTRACTORS.find(['.', '-path', '/etc/*']),
    ).toEqual(['.', '/etc/*'])
  })

  test('-- makes everything after positional', () => {
    expect(
      PATH_EXTRACTORS.find(['--', '-trickyroot', '-name', 'x']),
    ).toEqual(['-trickyroot', '-name', 'x'])
  })

  test('only predicates → ["."]', () => {
    expect(PATH_EXTRACTORS.find(['-name', 'foo'])).toEqual(['.'])
  })
})

describe('PATH_EXTRACTORS — rm/mv/cp simple flag-stripping', () => {
  test('rm: flags removed, positional kept', () => {
    expect(PATH_EXTRACTORS.rm(['-rf', '/foo', '/bar'])).toEqual([
      '/foo',
      '/bar',
    ])
  })

  test('rm with -- end-of-options: even -leading args become paths', () => {
    // Documented: SECURITY filterOutFlags handles -- correctly. Critical for
    // payloads like `rm -- -/../.claude/settings.local.json`.
    expect(
      PATH_EXTRACTORS.rm(['--', '-/../.claude/settings.local.json']),
    ).toEqual(['-/../.claude/settings.local.json'])
  })

  test('rm: no paths → empty array', () => {
    expect(PATH_EXTRACTORS.rm(['-rf'])).toEqual([])
  })

  test('mv: similar to rm', () => {
    expect(PATH_EXTRACTORS.mv(['-f', 'src', 'dst'])).toEqual(['src', 'dst'])
  })
})

describe('PATH_EXTRACTORS — grep', () => {
  test('grep PATTERN file → [file]', () => {
    expect(PATH_EXTRACTORS.grep(['foo', 'a.txt'])).toEqual(['a.txt'])
  })

  test('grep PATTERN (no file) → empty (stdin)', () => {
    expect(PATH_EXTRACTORS.grep(['foo'])).toEqual([])
  })

  test('grep -e PATTERN → no positional pattern needed → all positional are paths', () => {
    // Documented: -e marks pattern as found, so first positional is path.
    expect(
      PATH_EXTRACTORS.grep(['-e', 'foo', 'a.txt']),
    ).toEqual(['a.txt'])
  })

  test('grep with -r and no paths → ["."]', () => {
    // Documented special case: recursive grep without paths searches CWD.
    expect(PATH_EXTRACTORS.grep(['-r', 'foo'])).toEqual(['.'])
  })

  test('grep -A 3 (flag with value) skips next arg', () => {
    expect(
      PATH_EXTRACTORS.grep(['-A', '3', 'foo', 'a.txt']),
    ).toEqual(['a.txt'])
  })

  test('grep with -- end-of-options', () => {
    expect(
      PATH_EXTRACTORS.grep(['foo', '--', '-tricky.txt']),
    ).toEqual(['-tricky.txt'])
  })
})

describe('PATH_EXTRACTORS — rg', () => {
  test('rg PATTERN file → [file]', () => {
    expect(PATH_EXTRACTORS.rg(['foo', 'a.txt'])).toEqual(['a.txt'])
  })

  test('rg PATTERN (no file) → ["."] (rg defaults to CWD)', () => {
    expect(PATH_EXTRACTORS.rg(['foo'])).toEqual(['.'])
  })

  test('rg -t ts PATTERN → flag value consumed', () => {
    expect(PATH_EXTRACTORS.rg(['-t', 'ts', 'foo', 'a.txt'])).toEqual([
      'a.txt',
    ])
  })

  test('rg -e PATTERN → first positional is path (not pattern)', () => {
    expect(
      PATH_EXTRACTORS.rg(['-e', 'foo', 'a.txt']),
    ).toEqual(['a.txt'])
  })
})

describe('PATH_EXTRACTORS — sed', () => {
  test("sed 's/x/y/' file → [file]", () => {
    expect(PATH_EXTRACTORS.sed(["s/x/y/", 'a.txt'])).toEqual(['a.txt'])
  })

  test('sed -i expr file → [file]', () => {
    expect(
      PATH_EXTRACTORS.sed(['-i', "s/x/y/", 'a.txt']),
    ).toEqual(['a.txt'])
  })

  test('sed -e expr file → [file] (flag-args mode)', () => {
    expect(
      PATH_EXTRACTORS.sed(['-e', "s/x/y/", 'a.txt']),
    ).toEqual(['a.txt'])
  })

  test('sed -f script file → [script, file] (script is read)', () => {
    // Documented: -f's argument is a script file that needs validation.
    expect(
      PATH_EXTRACTORS.sed(['-f', 'script.sed', 'a.txt']),
    ).toEqual(['script.sed', 'a.txt'])
  })

  test('sed -- end-of-options: positional after is path', () => {
    expect(
      PATH_EXTRACTORS.sed(["s/x/y/", '--', '-tricky.txt']),
    ).toEqual(['-tricky.txt'])
  })

  test('sed expression only → no paths', () => {
    expect(PATH_EXTRACTORS.sed(["s/x/y/"])).toEqual([])
  })
})

describe('PATH_EXTRACTORS — jq', () => {
  test('jq filter file → [file]', () => {
    expect(PATH_EXTRACTORS.jq(['.foo', 'a.json'])).toEqual(['a.json'])
  })

  test('jq filter (no file) → empty (stdin)', () => {
    expect(PATH_EXTRACTORS.jq(['.foo'])).toEqual([])
  })

  test('jq -r filter file (flag without value)', () => {
    expect(PATH_EXTRACTORS.jq(['-r', '.foo', 'a.json'])).toEqual(['a.json'])
  })

  test('jq --arg name val filter file: --arg only skips ONE arg', () => {
    // Documented quirk: --arg actually takes TWO args (name + value), but
    // the helper's flagsWithArgs only skips one. So 'val' becomes the
    // filter, '.foo' and 'a.json' both end up as paths. This is a known
    // limitation locked in by the test.
    expect(
      PATH_EXTRACTORS.jq(['--arg', 'name', 'val', '.foo', 'a.json']),
    ).toEqual(['.foo', 'a.json'])
  })

  test('jq -e filter file: -e is flagsWithArgs → skips next, filter consumed', () => {
    // -e is in BOTH special-flags (marks filterFound) AND flagsWithArgs
    // (skips next arg). So '.foo' gets skipped as the -e value, then
    // 'a.json' is parsed as a path (filterFound was already true).
    expect(PATH_EXTRACTORS.jq(['-e', '.foo', 'a.json'])).toEqual(['a.json'])
  })
})

describe('PATH_EXTRACTORS — git', () => {
  test('git diff --no-index a b → [a, b]', () => {
    expect(
      PATH_EXTRACTORS.git(['diff', '--no-index', '/etc/passwd', '/tmp/x']),
    ).toEqual(['/etc/passwd', '/tmp/x'])
  })

  test('git diff (no --no-index) → [] (in-repo paths only)', () => {
    expect(PATH_EXTRACTORS.git(['diff', 'HEAD'])).toEqual([])
  })

  test('git status → [] (no path validation needed)', () => {
    expect(PATH_EXTRACTORS.git(['status'])).toEqual([])
  })

  test('git diff --no-index with -- end-of-options', () => {
    expect(
      PATH_EXTRACTORS.git(['diff', '--no-index', '--', '-tricky', '-tricky2']),
    ).toEqual(['-tricky', '-tricky2'])
  })

  test('git diff --no-index returns only first 2 paths (extra paths dropped)', () => {
    expect(
      PATH_EXTRACTORS.git(['diff', '--no-index', 'a', 'b', 'c', 'd']),
    ).toEqual(['a', 'b'])
  })
})

describe('PATH_EXTRACTORS — tr', () => {
  test('tr SET1 SET2 (no -d) → no paths (SET1+SET2 skipped)', () => {
    expect(PATH_EXTRACTORS.tr(['a', 'b'])).toEqual([])
  })

  test('tr -d SET → no paths (SET1 skipped)', () => {
    expect(PATH_EXTRACTORS.tr(['-d', 'a'])).toEqual([])
  })
})

// ──────────────────────────────────────────────────────────────────
// stripWrappersFromArgv: argv-level safe-wrapper stripping
// ──────────────────────────────────────────────────────────────────

describe('stripWrappersFromArgv — basic wrappers', () => {
  test('no wrapper → argv unchanged', () => {
    expect(stripWrappersFromArgv(['rm', '-rf', '/foo'])).toEqual([
      'rm',
      '-rf',
      '/foo',
    ])
  })

  test('time wrapper stripped', () => {
    expect(stripWrappersFromArgv(['time', 'rm', '-rf', '/foo'])).toEqual([
      'rm',
      '-rf',
      '/foo',
    ])
  })

  test('time -- wrapper stripped (skip --)', () => {
    expect(stripWrappersFromArgv(['time', '--', 'rm', '/foo'])).toEqual([
      'rm',
      '/foo',
    ])
  })

  test('nohup wrapper stripped', () => {
    expect(stripWrappersFromArgv(['nohup', 'rm', '/foo'])).toEqual([
      'rm',
      '/foo',
    ])
  })

  test('empty argv → empty', () => {
    expect(stripWrappersFromArgv([])).toEqual([])
  })
})

describe('stripWrappersFromArgv — timeout', () => {
  test('timeout 10 cmd → cmd', () => {
    expect(stripWrappersFromArgv(['timeout', '10', 'rm', '/foo'])).toEqual([
      'rm',
      '/foo',
    ])
  })

  test('timeout 5s cmd (duration with unit)', () => {
    expect(stripWrappersFromArgv(['timeout', '5s', 'rm', '/foo'])).toEqual([
      'rm',
      '/foo',
    ])
  })

  test('timeout -k 5 10 cmd (kill-after with separate value)', () => {
    expect(
      stripWrappersFromArgv(['timeout', '-k', '5', '10', 'rm', '/foo']),
    ).toEqual(['rm', '/foo'])
  })

  test('timeout --kill-after=5 10 cmd', () => {
    expect(
      stripWrappersFromArgv(['timeout', '--kill-after=5', '10', 'rm', '/foo']),
    ).toEqual(['rm', '/foo'])
  })

  test('timeout --foreground 10 cmd', () => {
    expect(
      stripWrappersFromArgv(['timeout', '--foreground', '10', 'rm', '/foo']),
    ).toEqual(['rm', '/foo'])
  })

  test('timeout -kTERM 10 cmd (fused short flag)', () => {
    expect(
      stripWrappersFromArgv(['timeout', '-kTERM', '10', 'rm', '/foo']),
    ).toEqual(['rm', '/foo'])
  })

  test('timeout with unparseable duration .5 → fail closed (return unchanged)', () => {
    // Documented: `.5` is a strtod GNU format, but we use \d+(\.\d+)?
    // strict pattern. Fail CLOSED → caller sees baseCmd='timeout' →
    // passthrough. Safe because checkSemantics also fails CLOSED.
    expect(stripWrappersFromArgv(['timeout', '.5', 'rm', '/foo'])).toEqual([
      'timeout',
      '.5',
      'rm',
      '/foo',
    ])
  })

  test('timeout with bad value char $ → fail closed', () => {
    // SECURITY: $-substituted values must NOT be stripped.
    // `timeout -k$(id) 10 ls` would otherwise strip and lose the danger.
    expect(
      stripWrappersFromArgv(['timeout', '-k$(id)', '10', 'rm', '/foo']),
    ).toEqual(['timeout', '-k$(id)', '10', 'rm', '/foo'])
  })

  test('timeout unknown long flag --weird → fail closed', () => {
    expect(
      stripWrappersFromArgv(['timeout', '--weird', '10', 'rm']),
    ).toEqual(['timeout', '--weird', '10', 'rm'])
  })
})

describe('stripWrappersFromArgv — nice', () => {
  test('nice cmd (bare) stripped', () => {
    expect(stripWrappersFromArgv(['nice', 'rm', '/foo'])).toEqual([
      'rm',
      '/foo',
    ])
  })

  test('nice -10 cmd (legacy form)', () => {
    expect(stripWrappersFromArgv(['nice', '-10', 'rm', '/foo'])).toEqual([
      'rm',
      '/foo',
    ])
  })

  test('nice -n 10 cmd (modern form)', () => {
    expect(stripWrappersFromArgv(['nice', '-n', '10', 'rm', '/foo'])).toEqual([
      'rm',
      '/foo',
    ])
  })

  test('nice -n 10 -- cmd', () => {
    expect(
      stripWrappersFromArgv(['nice', '-n', '10', '--', 'rm', '/foo']),
    ).toEqual(['rm', '/foo'])
  })

  test('nice negative -n -- cmd', () => {
    expect(
      stripWrappersFromArgv(['nice', '-n', '-5', 'rm', '/foo']),
    ).toEqual(['rm', '/foo'])
  })
})

describe('stripWrappersFromArgv — stdbuf', () => {
  test('stdbuf -o0 cmd (fused)', () => {
    expect(
      stripWrappersFromArgv(['stdbuf', '-o0', 'rm', '/foo']),
    ).toEqual(['rm', '/foo'])
  })

  test('stdbuf -o 0 cmd (separate)', () => {
    expect(
      stripWrappersFromArgv(['stdbuf', '-o', '0', 'rm', '/foo']),
    ).toEqual(['rm', '/foo'])
  })

  test('stdbuf --output=0 cmd (long form)', () => {
    expect(
      stripWrappersFromArgv(['stdbuf', '--output=0', 'rm', '/foo']),
    ).toEqual(['rm', '/foo'])
  })

  test('stdbuf -o0 -eL cmd (multiple flags)', () => {
    // Documented: PR #21503 round 3 widened to handle multiple stdbuf flags.
    expect(
      stripWrappersFromArgv(['stdbuf', '-o0', '-eL', 'rm', '/foo']),
    ).toEqual(['rm', '/foo'])
  })

  test('stdbuf without flags → return unchanged (no flags consumed = inert)', () => {
    expect(stripWrappersFromArgv(['stdbuf', 'rm', '/foo'])).toEqual([
      'stdbuf',
      'rm',
      '/foo',
    ])
  })

  test('stdbuf with unknown flag → fail closed', () => {
    expect(
      stripWrappersFromArgv(['stdbuf', '-z0', 'rm', '/foo']),
    ).toEqual(['stdbuf', '-z0', 'rm', '/foo'])
  })
})

describe('stripWrappersFromArgv — env', () => {
  test('env VAR=val cmd', () => {
    expect(
      stripWrappersFromArgv(['env', 'FOO=bar', 'rm', '/foo']),
    ).toEqual(['rm', '/foo'])
  })

  test('env -i cmd (clean env)', () => {
    expect(stripWrappersFromArgv(['env', '-i', 'rm', '/foo'])).toEqual([
      'rm',
      '/foo',
    ])
  })

  test('env -u NAME cmd (unset)', () => {
    expect(
      stripWrappersFromArgv(['env', '-u', 'NAME', 'rm', '/foo']),
    ).toEqual(['rm', '/foo'])
  })

  test('env -S cmd → fail closed (argv splitter rejected)', () => {
    expect(stripWrappersFromArgv(['env', '-S', 'rm /foo'])).toEqual([
      'env',
      '-S',
      'rm /foo',
    ])
  })

  test('env -C /tmp cmd → fail closed (altwd rejected)', () => {
    expect(
      stripWrappersFromArgv(['env', '-C', '/tmp', 'rm', '/foo']),
    ).toEqual(['env', '-C', '/tmp', 'rm', '/foo'])
  })
})

describe('stripWrappersFromArgv — chained wrappers', () => {
  test('time timeout 10 rm → rm', () => {
    expect(
      stripWrappersFromArgv(['time', 'timeout', '10', 'rm', '/foo']),
    ).toEqual(['rm', '/foo'])
  })

  test('nohup nice -n 5 rm → rm', () => {
    expect(
      stripWrappersFromArgv(['nohup', 'nice', '-n', '5', 'rm', '/foo']),
    ).toEqual(['rm', '/foo'])
  })

  test('env FOO=bar timeout 10 stdbuf -o0 rm → rm', () => {
    expect(
      stripWrappersFromArgv([
        'env',
        'FOO=bar',
        'timeout',
        '10',
        'stdbuf',
        '-o0',
        'rm',
        '/foo',
      ]),
    ).toEqual(['rm', '/foo'])
  })

  test('chain stops at first non-wrapper', () => {
    expect(
      stripWrappersFromArgv(['timeout', '10', 'echo', 'hi']),
    ).toEqual(['echo', 'hi'])
  })

  test('chain with bad wrapper in middle stops there', () => {
    // timeout strips, but env -S is fail-closed → returns argv at that point.
    expect(
      stripWrappersFromArgv(['timeout', '10', 'env', '-S', 'rm /foo']),
    ).toEqual(['env', '-S', 'rm /foo'])
  })
})
