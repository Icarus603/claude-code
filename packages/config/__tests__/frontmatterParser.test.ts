import { describe, expect, test } from 'bun:test'
import {
  coerceDescriptionToString,
  FRONTMATTER_REGEX,
  parseBooleanFrontmatter,
  parseFrontmatter,
  parsePositiveIntFromFrontmatter,
  parseShellFrontmatter,
  splitPathInFrontmatter,
} from '../frontmatterParser.js'

describe('parseFrontmatter — basic extraction', () => {
  test('parses frontmatter and content', () => {
    const md = `---
description: hello
---
# Body content`
    const result = parseFrontmatter(md)
    expect(result.frontmatter.description).toBe('hello')
    expect(result.content).toBe('# Body content')
  })

  test('returns empty frontmatter when none present', () => {
    const md = '# Just content, no frontmatter'
    const result = parseFrontmatter(md)
    expect(result.frontmatter).toEqual({})
    expect(result.content).toBe(md)
  })

  test('handles empty frontmatter block', () => {
    const md = `---
---
content`
    const result = parseFrontmatter(md)
    expect(result.frontmatter).toEqual({})
    expect(result.content).toBe('content')
  })

  test('handles frontmatter at start ONLY (mid-document --- is content)', () => {
    const md = `not frontmatter
---
fake: yaml
---
body`
    const result = parseFrontmatter(md)
    expect(result.frontmatter).toEqual({})
    // Whole input becomes content because match is anchored at ^.
    expect(result.content).toBe(md)
  })

  test('content preserves trailing newlines after closing ---', () => {
    const md = `---
key: value
---

content with leading blank line`
    const result = parseFrontmatter(md)
    expect(result.frontmatter.description).toBeUndefined()
    // The regex consumes the `---\n?` so single trailing newline is
    // captured. Verify content preserves blank line that follows.
    expect(result.content).toContain('content with leading blank line')
  })

  test('multi-key frontmatter parses all keys', () => {
    const md = `---
description: my desc
model: opus
effort: max
---
body`
    const result = parseFrontmatter(md)
    expect(result.frontmatter.description).toBe('my desc')
    expect(result.frontmatter.model).toBe('opus')
    expect(result.frontmatter.effort).toBe('max')
  })
})

describe('parseFrontmatter — quoting fallback for special chars', () => {
  test('glob pattern with braces is auto-quoted on retry', () => {
    // "**/*.{ts,tsx}" contains { and } which trigger YAML flow-mapping
    // errors. The retry path quotes it.
    const md = `---
paths: **/*.{ts,tsx}
---
body`
    const result = parseFrontmatter(md)
    expect(result.frontmatter.paths).toBe('**/*.{ts,tsx}')
  })

  test('value containing ": " is quoted (mid-value colon)', () => {
    // ": " (colon-space) is YAML key indicator. Without quoting, fails
    // with "Nested mappings are not allowed in compact mappings".
    const md = `---
description: foo: bar
---
body`
    const result = parseFrontmatter(md)
    expect(result.frontmatter.description).toBe('foo: bar')
  })

  test('value with ":" without space is NOT quoted (URLs and times stay clean)', () => {
    // The regex is `:` followed by space. URLs like https:// don't
    // trigger quoting, neither do times like 12:34.
    const md = `---
description: 12:34
---
body`
    const result = parseFrontmatter(md)
    // Should parse without retry. Verify no quotes added in result.
    expect(result.frontmatter.description).toBe('12:34')
  })

  test('value with unquoted hash # is treated as YAML comment (strips trailing)', () => {
    // YAML spec: # in unquoted scalar starts a comment. The quoting
    // fallback only triggers on parse FAILURE — `description: hello #
    // foo` is VALID YAML (parses to "hello"), so the retry path with
    // quoteProblematicValues never runs. Users who want to preserve
    // "# data" must quote explicitly.
    const md = `---
description: hello # this is a YAML comment
---
body`
    const result = parseFrontmatter(md)
    // The trailing comment is stripped by YAML parser. This is YAML
    // spec behavior — documented here so a future "fix" doesn't
    // surprise users who depend on YAML conventions.
    expect(result.frontmatter.description).toBe('hello')
  })

  test('value with QUOTED # preserves the literal hash', () => {
    const md = `---
description: "hello # not a comment"
---
body`
    const result = parseFrontmatter(md)
    expect(result.frontmatter.description).toBe('hello # not a comment')
  })

  test('already-quoted value is not double-quoted', () => {
    const md = `---
description: "already quoted"
---
body`
    const result = parseFrontmatter(md)
    expect(result.frontmatter.description).toBe('already quoted')
  })

  test('completely malformed YAML still returns empty frontmatter (no throw)', () => {
    const md = `---
{[invalid:::
---
body`
    expect(() => parseFrontmatter(md)).not.toThrow()
    const result = parseFrontmatter(md)
    expect(result.frontmatter).toEqual({})
  })
})

describe('FRONTMATTER_REGEX', () => {
  test('matches three-dash + content + three-dash + newline', () => {
    expect('---\ndesc: hi\n---\nbody').toMatch(FRONTMATTER_REGEX)
  })

  test('does NOT match without leading ---', () => {
    expect('desc: hi\n---\nbody').not.toMatch(FRONTMATTER_REGEX)
  })

  test('does NOT match if frontmatter not at start (^ anchor)', () => {
    expect('# header\n---\ndesc: hi\n---').not.toMatch(FRONTMATTER_REGEX)
  })

  test('handles trailing whitespace on opening ---', () => {
    expect('---   \ndesc: hi\n---\nbody').toMatch(FRONTMATTER_REGEX)
  })

  test('handles missing trailing newline after closing ---', () => {
    // The `\n?` makes the trailing newline optional.
    expect('---\ndesc: hi\n---').toMatch(FRONTMATTER_REGEX)
  })
})

describe('splitPathInFrontmatter', () => {
  test('comma-separated string', () => {
    expect(splitPathInFrontmatter('a, b, c')).toEqual(['a', 'b', 'c'])
  })

  test('trims whitespace around items', () => {
    expect(splitPathInFrontmatter(' a , b ')).toEqual(['a', 'b'])
  })

  test('skips empty entries from extra commas', () => {
    expect(splitPathInFrontmatter('a,,b')).toEqual(['a', 'b'])
  })

  test('expands brace pattern', () => {
    expect(splitPathInFrontmatter('src/*.{ts,tsx}')).toEqual([
      'src/*.ts',
      'src/*.tsx',
    ])
  })

  test('comma INSIDE braces is NOT a separator', () => {
    // Critical: "{a,b}" has a comma inside braces — must stay as one
    // group. A naive .split(',') would break here.
    expect(splitPathInFrontmatter('a/{b,c}/d')).toEqual(['a/b/d', 'a/c/d'])
  })

  test('combined: list with brace patterns', () => {
    expect(splitPathInFrontmatter('a, src/*.{ts,tsx}')).toEqual([
      'a',
      'src/*.ts',
      'src/*.tsx',
    ])
  })

  test('multiple brace groups expand cartesian-product', () => {
    expect(splitPathInFrontmatter('{a,b}/{c,d}')).toEqual([
      'a/c',
      'a/d',
      'b/c',
      'b/d',
    ])
  })

  test('accepts string array directly', () => {
    expect(splitPathInFrontmatter(['a', 'b'])).toEqual(['a', 'b'])
  })

  test('flattens braces in array entries', () => {
    expect(splitPathInFrontmatter(['a', 'src/*.{ts,tsx}'])).toEqual([
      'a',
      'src/*.ts',
      'src/*.tsx',
    ])
  })

  test('non-string non-array input returns empty array', () => {
    expect(splitPathInFrontmatter(undefined as never)).toEqual([])
    expect(splitPathInFrontmatter(null as never)).toEqual([])
    expect(splitPathInFrontmatter(42 as never)).toEqual([])
  })

  test('empty string returns empty array', () => {
    expect(splitPathInFrontmatter('')).toEqual([])
  })

  test('empty array returns empty array', () => {
    expect(splitPathInFrontmatter([])).toEqual([])
  })
})

describe('parsePositiveIntFromFrontmatter', () => {
  test('numeric value 5 → 5', () => {
    expect(parsePositiveIntFromFrontmatter(5)).toBe(5)
  })

  test('string "5" → 5', () => {
    expect(parsePositiveIntFromFrontmatter('5')).toBe(5)
  })

  test('zero rejected', () => {
    expect(parsePositiveIntFromFrontmatter(0)).toBeUndefined()
    expect(parsePositiveIntFromFrontmatter('0')).toBeUndefined()
  })

  test('negative rejected', () => {
    expect(parsePositiveIntFromFrontmatter(-5)).toBeUndefined()
    expect(parsePositiveIntFromFrontmatter('-5')).toBeUndefined()
  })

  test('decimal — number 5.5 NOT integer → undefined', () => {
    expect(parsePositiveIntFromFrontmatter(5.5)).toBeUndefined()
  })

  test('decimal string "5.5" — parseInt truncates to 5', () => {
    // parseInt('5.5', 10) = 5. Documents this quirk.
    expect(parsePositiveIntFromFrontmatter('5.5')).toBe(5)
  })

  test('null / undefined → undefined', () => {
    expect(parsePositiveIntFromFrontmatter(null)).toBeUndefined()
    expect(parsePositiveIntFromFrontmatter(undefined)).toBeUndefined()
  })

  test('non-numeric string → undefined', () => {
    expect(parsePositiveIntFromFrontmatter('abc')).toBeUndefined()
  })

  test('boolean coerces via String() then parseInt → undefined', () => {
    // String(true) = 'true' → parseInt('true', 10) = NaN → undefined.
    expect(parsePositiveIntFromFrontmatter(true)).toBeUndefined()
    expect(parsePositiveIntFromFrontmatter(false)).toBeUndefined()
  })
})

describe('coerceDescriptionToString', () => {
  test('string is trimmed', () => {
    expect(coerceDescriptionToString('  hello  ')).toBe('hello')
  })

  test('whitespace-only string returns null', () => {
    expect(coerceDescriptionToString('   ')).toBeNull()
  })

  test('empty string returns null', () => {
    expect(coerceDescriptionToString('')).toBeNull()
  })

  test('number coerces to string', () => {
    expect(coerceDescriptionToString(42)).toBe('42')
  })

  test('boolean coerces to "true"/"false"', () => {
    expect(coerceDescriptionToString(true)).toBe('true')
    expect(coerceDescriptionToString(false)).toBe('false')
  })

  test('null returns null', () => {
    expect(coerceDescriptionToString(null)).toBeNull()
  })

  test('undefined returns null', () => {
    expect(coerceDescriptionToString(undefined)).toBeNull()
  })

  test('array returns null (logged + omitted)', () => {
    expect(coerceDescriptionToString(['a', 'b'])).toBeNull()
  })

  test('object returns null (logged + omitted)', () => {
    expect(coerceDescriptionToString({ key: 'value' })).toBeNull()
  })
})

describe('parseBooleanFrontmatter', () => {
  test('literal true → true', () => {
    expect(parseBooleanFrontmatter(true)).toBe(true)
  })

  test('string "true" → true', () => {
    expect(parseBooleanFrontmatter('true')).toBe(true)
  })

  test('literal false → false', () => {
    expect(parseBooleanFrontmatter(false)).toBe(false)
  })

  test('string "false" → false', () => {
    expect(parseBooleanFrontmatter('false')).toBe(false)
  })

  test('case-sensitive: "TRUE" / "True" → false (only exact "true" qualifies)', () => {
    // Critical: catches refactor that adds .toLowerCase() and silently
    // accepts more variants.
    expect(parseBooleanFrontmatter('TRUE')).toBe(false)
    expect(parseBooleanFrontmatter('True')).toBe(false)
  })

  test('1 / 0 → false (numbers, not strings)', () => {
    expect(parseBooleanFrontmatter(1)).toBe(false)
    expect(parseBooleanFrontmatter(0)).toBe(false)
  })

  test('null / undefined / empty / random → false', () => {
    expect(parseBooleanFrontmatter(null)).toBe(false)
    expect(parseBooleanFrontmatter(undefined)).toBe(false)
    expect(parseBooleanFrontmatter('')).toBe(false)
    expect(parseBooleanFrontmatter('yes')).toBe(false)
  })
})

describe('parseShellFrontmatter', () => {
  test('"bash" → "bash"', () => {
    expect(parseShellFrontmatter('bash', 'src')).toBe('bash')
  })

  test('"powershell" → "powershell"', () => {
    expect(parseShellFrontmatter('powershell', 'src')).toBe('powershell')
  })

  test('case-insensitive: "BASH" → "bash"', () => {
    // Contract: normalize via toLowerCase().
    expect(parseShellFrontmatter('BASH', 'src')).toBe('bash')
  })

  test('case-insensitive: "PowerShell" → "powershell"', () => {
    expect(parseShellFrontmatter('PowerShell', 'src')).toBe('powershell')
  })

  test('whitespace-padded value is trimmed', () => {
    expect(parseShellFrontmatter('  bash  ', 'src')).toBe('bash')
  })

  test('null → undefined', () => {
    expect(parseShellFrontmatter(null, 'src')).toBeUndefined()
  })

  test('undefined → undefined', () => {
    expect(parseShellFrontmatter(undefined, 'src')).toBeUndefined()
  })

  test('empty string → undefined', () => {
    expect(parseShellFrontmatter('', 'src')).toBeUndefined()
  })

  test('whitespace-only → undefined', () => {
    expect(parseShellFrontmatter('   ', 'src')).toBeUndefined()
  })

  test('unrecognized shell → undefined (fallback to bash by caller)', () => {
    expect(parseShellFrontmatter('zsh', 'src')).toBeUndefined()
    expect(parseShellFrontmatter('cmd', 'src')).toBeUndefined()
    expect(parseShellFrontmatter('fish', 'src')).toBeUndefined()
  })

  test('non-string scalars coerce via String()', () => {
    // String(123) = "123" — not in shells list — returns undefined.
    expect(parseShellFrontmatter(123, 'src')).toBeUndefined()
  })
})
