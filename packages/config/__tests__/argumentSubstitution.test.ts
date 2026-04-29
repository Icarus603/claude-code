import { describe, expect, test } from 'bun:test'
import {
  generateProgressiveArgumentHint,
  parseArgumentNames,
  parseArguments,
  substituteArguments,
} from '../utils/argumentSubstitution.js'

describe('parseArguments', () => {
  test('splits on whitespace', () => {
    expect(parseArguments('foo bar baz')).toEqual(['foo', 'bar', 'baz'])
  })
  test('respects double-quoted strings', () => {
    expect(parseArguments('foo "hello world" baz')).toEqual([
      'foo',
      'hello world',
      'baz',
    ])
  })
  test('respects single-quoted strings', () => {
    expect(parseArguments("foo 'hello world' baz")).toEqual([
      'foo',
      'hello world',
      'baz',
    ])
  })
  test('preserves $VAR literally (does not expand)', () => {
    expect(parseArguments('$FOO bar')).toEqual(['$FOO', 'bar'])
  })
  test('empty input produces empty array', () => {
    expect(parseArguments('')).toEqual([])
    expect(parseArguments('   ')).toEqual([])
  })
})

describe('parseArgumentNames', () => {
  test('splits space-separated string', () => {
    expect(parseArgumentNames('foo bar baz')).toEqual(['foo', 'bar', 'baz'])
  })
  test('accepts string array verbatim', () => {
    expect(parseArgumentNames(['foo', 'bar'])).toEqual(['foo', 'bar'])
  })
  test('filters out numeric-only names (would conflict with $0, $1)', () => {
    expect(parseArgumentNames('foo 1 2 bar')).toEqual(['foo', 'bar'])
  })
  test('filters empty strings', () => {
    expect(parseArgumentNames(['foo', '', 'bar'])).toEqual(['foo', 'bar'])
  })
  test('undefined produces empty array', () => {
    expect(parseArgumentNames(undefined)).toEqual([])
  })
})

describe('generateProgressiveArgumentHint', () => {
  test('returns hint for unfilled args', () => {
    expect(
      generateProgressiveArgumentHint(['source', 'dest', 'mode'], ['file.txt']),
    ).toBe('[dest] [mode]')
  })
  test('returns undefined when all args filled', () => {
    expect(
      generateProgressiveArgumentHint(['a', 'b'], ['x', 'y', 'extra']),
    ).toBeUndefined()
  })
  test('returns full hint when none filled', () => {
    expect(generateProgressiveArgumentHint(['a', 'b', 'c'], [])).toBe(
      '[a] [b] [c]',
    )
  })
  test('empty argNames returns undefined', () => {
    expect(generateProgressiveArgumentHint([], [])).toBeUndefined()
  })
})

describe('substituteArguments', () => {
  test('replaces $ARGUMENTS with full args string', () => {
    expect(substituteArguments('Run with $ARGUMENTS', 'foo bar')).toBe(
      'Run with foo bar',
    )
  })
  test('replaces $ARGUMENTS[0], $ARGUMENTS[1] with indexed args', () => {
    expect(
      substituteArguments(
        'first=$ARGUMENTS[0] second=$ARGUMENTS[1]',
        'alpha beta',
      ),
    ).toBe('first=alpha second=beta')
  })
  test('replaces $0, $1 shorthand', () => {
    expect(substituteArguments('$0 then $1', 'first second')).toBe(
      'first then second',
    )
  })
  test('replaces named args ($foo, $bar) when names defined', () => {
    expect(
      substituteArguments('$foo and $bar', 'A B', false, ['foo', 'bar']),
    ).toBe('A and B')
  })
  test('named arg does not match prefix substring (regression: $name vs $namePart)', () => {
    expect(
      substituteArguments('$foo $foobar', 'x', false, ['foo']),
    ).toBe('x $foobar')
  })
  test('out-of-range indexed args become empty string', () => {
    expect(substituteArguments('$0 $1 $2', 'only-one')).toBe('only-one  ')
  })
  test('appendIfNoPlaceholder appends ARGUMENTS section by default', () => {
    expect(substituteArguments('static body', 'whatever')).toBe(
      'static body\n\nARGUMENTS: whatever',
    )
  })
  test('appendIfNoPlaceholder=false leaves content alone if no placeholders', () => {
    expect(substituteArguments('static body', 'whatever', false)).toBe(
      'static body',
    )
  })
  test('append is skipped for empty args even with appendIfNoPlaceholder=true', () => {
    expect(substituteArguments('body', '')).toBe('body')
  })
  test('undefined args returns content unchanged', () => {
    expect(substituteArguments('$ARGUMENTS', undefined)).toBe('$ARGUMENTS')
  })
  test('empty args still expands $ARGUMENTS placeholder', () => {
    expect(substituteArguments('value=$ARGUMENTS', '')).toBe('value=')
  })
})
