/**
 * Tests for the PowerShell stderr classifier — invariants against ant
 * v2.1.136 `Qo5` table (3999.js Yl7).
 *
 * Each category is exercised against an actual PowerShell stderr string
 * (excerpted from real failures); negative cases assert categories DO
 * NOT match unrelated noise.
 */
import { describe, expect, test } from 'bun:test'
import {
  classifyPowerShellError,
  getPwshParseTimeoutMs,
} from '../errorClassifier.js'

describe('classifyPowerShellError — positive matches', () => {
  test('ps5_chain_op: token && error', () => {
    expect(
      classifyPowerShellError(
        "The token '&&' is not a valid statement separator in this version.",
      ),
    ).toBe('ps5_chain_op')
  })

  test('ps5_chain_op: token || error', () => {
    expect(
      classifyPowerShellError("The token '||' is not a valid statement separator."),
    ).toBe('ps5_chain_op')
  })

  test('ps5_chain_op: token ?? null-coalescing (PS5 unsupported)', () => {
    expect(
      classifyPowerShellError(
        "The token '??' is not a valid statement separator in this version.",
      ),
    ).toBe('ps5_chain_op')
  })

  test('ps5_chain_op: InvalidEndOfLine', () => {
    expect(
      classifyPowerShellError('Parse exception: InvalidEndOfLine'),
    ).toBe('ps5_chain_op')
  })

  test('parser_error: ParserError prefix', () => {
    expect(classifyPowerShellError('ParserError: unexpected token')).toBe(
      'parser_error',
    )
  })

  test('parser_error: ParseException', () => {
    expect(classifyPowerShellError('System.Management.Automation.ParseException')).toBe(
      'parser_error',
    )
  })

  test('parser_error: TerminatorExpectedAtEndOfString', () => {
    expect(classifyPowerShellError('TerminatorExpectedAtEndOfString error')).toBe(
      'parser_error',
    )
  })

  test('not_recognized: cmdlet name lookup', () => {
    expect(
      classifyPowerShellError(
        "The term 'fakecmd' is not recognized as the name of a cmdlet, function, script file, or operable program.",
      ),
    ).toBe('not_recognized')
  })

  test("not_recognized: 'an internal' variant (cmd.exe-style msg)", () => {
    expect(
      classifyPowerShellError(
        "'fakecmd' is not recognized as an internal or external command",
      ),
    ).toBe('not_recognized')
  })

  test('command_not_found: CommandNotFoundException', () => {
    // not_recognized comes first in the table, so plain
    // CommandNotFoundException without "is not recognized" lands here.
    expect(
      classifyPowerShellError(
        'System.Management.Automation.CommandNotFoundException at top of stack',
      ),
    ).toBe('command_not_found')
  })

  test('native_command_error: NativeCommandError', () => {
    expect(
      classifyPowerShellError(
        'WriteErrorException ... NativeCommandError occurred while executing.',
      ),
    ).toBe('native_command_error')
  })

  test('native_command_error: RemoteException', () => {
    expect(
      classifyPowerShellError('Some remote thing\nRemoteException at the top'),
    ).toBe('native_command_error')
  })

  test('path_not_found: ItemNotFoundException', () => {
    expect(
      classifyPowerShellError(
        'Cannot find path because of ItemNotFoundException at line 3',
      ),
    ).toBe('path_not_found')
  })

  test('path_not_found: PathNotFound,Microsoft.PowerShell (FullyQualifiedErrorId)', () => {
    expect(
      classifyPowerShellError(
        '+ FullyQualifiedErrorId : PathNotFound,Microsoft.PowerShell.Commands.GetChildItemCommand',
      ),
    ).toBe('path_not_found')
  })

  test('access_denied: UnauthorizedAccessException', () => {
    expect(
      classifyPowerShellError(
        'UnauthorizedAccessException: cannot write to readonly file',
      ),
    ).toBe('access_denied')
  })

  test('access_denied: PermissionDenied,Microsoft.PowerShell', () => {
    expect(
      classifyPowerShellError(
        '+ FullyQualifiedErrorId : PermissionDenied,Microsoft.PowerShell.Commands.RemoveItemCommand',
      ),
    ).toBe('access_denied')
  })

  test('parameter_binding: ParameterBindingException', () => {
    expect(
      classifyPowerShellError(
        'Cmdlet does not accept that param — ParameterBindingException',
      ),
    ).toBe('parameter_binding')
  })

  test('parameter_binding: ParameterArgumentValidationError', () => {
    expect(
      classifyPowerShellError(
        'ParameterArgumentValidationError: argument out of range',
      ),
    ).toBe('parameter_binding')
  })

  test('object_not_found: ObjectNotFound: ( pattern', () => {
    // The ordering rule (command_not_found before object_not_found in
    // Qo5) makes a stderr that contains BOTH `CommandNotFoundException`
    // AND `ObjectNotFound: (` classify as command_not_found. ant ships
    // the same order; we only assert object_not_found wins when the
    // text contains the ObjectNotFound pattern WITHOUT the
    // CommandNotFoundException one. Real PS stderr that lands here is
    // typically a Get-Variable / Get-ChildItem on a missing object,
    // where ObjectNotFound is present but CommandNotFoundException is
    // not.
    expect(
      classifyPowerShellError(
        '+ CategoryInfo          : ObjectNotFound: (Variable:missing) [Get-Variable], ItemNotFoundException',
      ),
    ).toBe('path_not_found')
    // Confirm ObjectNotFound: ( pattern matches when no earlier rule wins:
    expect(
      classifyPowerShellError(
        'foo bar ObjectNotFound: (something) [...]',
      ),
    ).toBe('object_not_found')
  })

  test('object_not_found: DriveNotFoundException', () => {
    expect(
      classifyPowerShellError('DriveNotFoundException at line 7'),
    ).toBe('object_not_found')
  })

  test('execution_policy: running scripts disabled', () => {
    expect(
      classifyPowerShellError(
        'File C:\\foo.ps1 cannot be loaded because running scripts is disabled on this system.',
      ),
    ).toBe('execution_policy')
  })

  test('execution_policy: PSSecurityException', () => {
    expect(
      classifyPowerShellError(
        'System.Management.Automation.PSSecurityException at line 10',
      ),
    ).toBe('execution_policy')
  })

  test('native_npm: npm ERR! at line start', () => {
    expect(
      classifyPowerShellError(
        'some preamble\nnpm ERR! code ENOENT\nnpm ERR! syscall open',
      ),
    ).toBe('native_npm')
  })

  test('native_npm: lowercase npm error at line start', () => {
    expect(classifyPowerShellError('npm error code 1')).toBe('native_npm')
  })

  test('native_dotnet: CS error code', () => {
    expect(
      classifyPowerShellError('Program.cs(10,5): error CS0103: not defined'),
    ).toBe('native_dotnet')
  })

  test('native_dotnet: NU package code (NuGet)', () => {
    // ant uses /[A-Z]{2,}\d{4}/ — supports any 2+ uppercase prefix.
    expect(
      classifyPowerShellError(
        'project.csproj : error NU1101: package not found',
      ),
    ).toBe('native_dotnet')
  })

  test('native_dotnet: Build FAILED line-start', () => {
    expect(classifyPowerShellError('msbuild output\nBuild FAILED.')).toBe(
      'native_dotnet',
    )
  })
})

describe('classifyPowerShellError — negative cases', () => {
  test('empty input → other', () => {
    expect(classifyPowerShellError('')).toBe('other')
  })

  test('unrelated text → other', () => {
    expect(
      classifyPowerShellError('totally bogus output without keywords'),
    ).toBe('other')
  })

  test('lowercase commandnotfoundexception → other (regex is case-sensitive)', () => {
    // ant Qo5 deliberately does NOT use /i on command_not_found; PS
    // error IDs are case-sensitive.
    expect(classifyPowerShellError('commandnotfoundexception')).toBe('other')
  })

  test('npm WARN at start does NOT trigger native_npm', () => {
    // ant's `/^npm (ERR!|error)/m` excludes WARN.
    expect(classifyPowerShellError('npm WARN deprecated@1.0.0')).toBe('other')
  })

  test('mid-line "npm ERR!" does NOT trigger (^/m anchors per-line)', () => {
    // The phrase must start a line. Inline mentions don't qualify.
    expect(
      classifyPowerShellError('We wrapped output: see npm ERR! below'),
    ).toBe('other')
  })

  test('dotnet pattern requires 2+ uppercase prefix', () => {
    // `: error E1234:` is only one capital letter, so won't match.
    expect(classifyPowerShellError(': error E1234: foo')).toBe('other')
  })
})

describe('classifyPowerShellError — ordering invariant', () => {
  // PS 5.x `&&` errors often include "CommandNotFoundException"
  // because the parser falls through. ant Qo5 puts ps5_chain_op
  // FIRST so the more useful root cause wins.
  test('ps5_chain_op wins over command_not_found when both present', () => {
    expect(
      classifyPowerShellError(
        "The token '&&' is not a valid statement separator. CommandNotFoundException at line 2.",
      ),
    ).toBe('ps5_chain_op')
  })

  test('not_recognized wins over command_not_found when both present', () => {
    expect(
      classifyPowerShellError(
        "The term 'foo' is not recognized as the name of a cmdlet. Also: CommandNotFoundException.",
      ),
    ).toBe('not_recognized')
  })
})

describe('getPwshParseTimeoutMs', () => {
  test('default 5000ms when env unset', () => {
    expect(getPwshParseTimeoutMs()).toBe(5000)
  })
})
