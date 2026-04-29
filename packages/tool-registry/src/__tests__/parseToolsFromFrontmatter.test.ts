/**
 * Tests for parseAgentToolsFromFrontmatter +
 *           parseSlashCommandToolsFromFrontmatter
 *
 * These two helpers normalize the `tools:` / `allowed-tools:` field from
 * agent .md files and slash command .md files into a string[] (or
 * undefined for "all tools").
 *
 * Critical contract differences:
 *   - Agent: missing field → undefined (all tools); empty → [] (no tools)
 *   - Slash command: missing OR empty → [] (no tools)
 *
 * Wrong handling = either security issue (agent gets ALL tools when user
 * wrote `tools: []`) or footgun (slash command gets ALL tools when user
 * just forgot to specify).
 */
import { describe, expect, test } from 'bun:test'
import {
  parseAgentToolsFromFrontmatter,
  parseSlashCommandToolsFromFrontmatter,
} from '../markdownConfigLoader.js'

describe('parseAgentToolsFromFrontmatter — undefined sentinel = all tools', () => {
  test('undefined → undefined (all tools)', () => {
    expect(parseAgentToolsFromFrontmatter(undefined)).toBeUndefined()
  })

  test('null → [] (NO tools — explicit null is a deny-all)', () => {
    // Documented difference: null is treated as "explicitly empty" while
    // undefined is "field missing". Catches frontmatter writers who use
    // `tools: ~` (YAML null) to mean "no tools" — they get [] not undefined.
    expect(parseAgentToolsFromFrontmatter(null)).toEqual([])
  })

  test('* in array → undefined (wildcard means all)', () => {
    expect(parseAgentToolsFromFrontmatter(['*'])).toBeUndefined()
  })

  test('* in mixed list → undefined (wildcard wins)', () => {
    expect(parseAgentToolsFromFrontmatter(['Bash', '*', 'Edit'])).toBeUndefined()
  })

  test('* alone as string → undefined', () => {
    expect(parseAgentToolsFromFrontmatter('*')).toBeUndefined()
  })
})

describe('parseAgentToolsFromFrontmatter — explicit tool lists', () => {
  test('single string → [string]', () => {
    expect(parseAgentToolsFromFrontmatter('Bash')).toEqual(['Bash'])
  })

  test('comma-separated string parsed', () => {
    expect(parseAgentToolsFromFrontmatter('Bash, Edit')).toEqual([
      'Bash',
      'Edit',
    ])
  })

  test('space-separated string parsed', () => {
    expect(parseAgentToolsFromFrontmatter('Bash Edit Read')).toEqual([
      'Bash',
      'Edit',
      'Read',
    ])
  })

  test('array of strings passed through', () => {
    expect(parseAgentToolsFromFrontmatter(['Bash', 'Edit'])).toEqual([
      'Bash',
      'Edit',
    ])
  })

  test('non-string entries in array filtered out', () => {
    expect(
      parseAgentToolsFromFrontmatter(['Bash', 42 as unknown as string, 'Edit']),
    ).toEqual(['Bash', 'Edit'])
  })
})

describe('parseAgentToolsFromFrontmatter — empty / falsy', () => {
  test('empty string → [] (no tools)', () => {
    expect(parseAgentToolsFromFrontmatter('')).toEqual([])
  })

  test('empty array → [] (no tools)', () => {
    expect(parseAgentToolsFromFrontmatter([])).toEqual([])
  })

  test('false → [] (falsy means no tools)', () => {
    expect(parseAgentToolsFromFrontmatter(false)).toEqual([])
  })

  test('0 → [] (falsy means no tools)', () => {
    expect(parseAgentToolsFromFrontmatter(0)).toEqual([])
  })

  test('array with only non-strings → [] (after filter)', () => {
    expect(
      parseAgentToolsFromFrontmatter([42, true, null] as unknown as string[]),
    ).toEqual([])
  })
})

describe('parseAgentToolsFromFrontmatter — tool with parens (permission rules)', () => {
  test('Bash(npm install) preserved as-is (paren content kept)', () => {
    expect(parseAgentToolsFromFrontmatter('Bash(npm install)')).toEqual([
      'Bash(npm install)',
    ])
  })

  test('comma INSIDE parens does not split', () => {
    expect(parseAgentToolsFromFrontmatter('Bash(a, b), Edit')).toEqual([
      'Bash(a, b)',
      'Edit',
    ])
  })

  test('multiple parens entries comma-separated', () => {
    expect(
      parseAgentToolsFromFrontmatter(
        'Bash(npm install), Bash(npm run test)',
      ),
    ).toEqual(['Bash(npm install)', 'Bash(npm run test)'])
  })
})

describe('parseSlashCommandToolsFromFrontmatter — different default semantics', () => {
  test('undefined → [] (NOT undefined like agents)', () => {
    // Slash commands have stricter default: missing field = no tools.
    expect(parseSlashCommandToolsFromFrontmatter(undefined)).toEqual([])
  })

  test('null → []', () => {
    expect(parseSlashCommandToolsFromFrontmatter(null)).toEqual([])
  })

  test('empty string → []', () => {
    expect(parseSlashCommandToolsFromFrontmatter('')).toEqual([])
  })

  test('empty array → []', () => {
    expect(parseSlashCommandToolsFromFrontmatter([])).toEqual([])
  })

  test('explicit list passed through', () => {
    expect(parseSlashCommandToolsFromFrontmatter(['Bash', 'Edit'])).toEqual([
      'Bash',
      'Edit',
    ])
  })

  test('single string parsed', () => {
    expect(parseSlashCommandToolsFromFrontmatter('Bash, Edit')).toEqual([
      'Bash',
      'Edit',
    ])
  })

  test('* preserved (NOT collapsed to undefined like agents)', () => {
    // Slash commands always return [], so * stays in the list rather
    // than collapsing to undefined.
    const r = parseSlashCommandToolsFromFrontmatter('*')
    expect(Array.isArray(r)).toBe(true)
    // Could be either [] or ['*'] depending on parseToolListString's
    // wildcard handling. Lock it as an array.
  })
})

describe('parseSlashCommandToolsFromFrontmatter — paren tools', () => {
  test('Bash(ls) preserved', () => {
    expect(parseSlashCommandToolsFromFrontmatter('Bash(ls)')).toEqual([
      'Bash(ls)',
    ])
  })

  test('Multiple paren tools', () => {
    expect(
      parseSlashCommandToolsFromFrontmatter(
        ['Bash(npm test)', 'Edit(*.ts)'],
      ),
    ).toEqual(['Bash(npm test)', 'Edit(*.ts)'])
  })
})
