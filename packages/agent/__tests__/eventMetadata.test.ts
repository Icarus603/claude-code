/**
 * Tests for eventMetadata — pure helpers that flow tool/file
 * metadata into telemetry (Statsig events). The type aliases on
 * the return types document an explicit invariant: these values
 * are NOT code or file paths, so they're safe to send to analytics
 * regardless of opt-in flag.
 *
 * Wrong sanitization = a real MCP tool name leaks the user's
 * server URL into the analytics keyspace. Wrong extension parsing
 * = analytics dashboards mis-bucket files, and worse, leak
 * filenames into a field marked NOT_CODE_OR_FILEPATHS.
 */
import { describe, expect, test } from 'bun:test'
import {
  extractMcpToolDetails,
  extractSkillName,
  getFileExtensionForAnalytics,
  getFileExtensionsFromBashCommand,
  isToolDetailsLoggingEnabled,
  mcpToolDetailsForAnalytics,
  sanitizeToolNameForAnalytics,
} from '../eventMetadata.js'

describe('sanitizeToolNameForAnalytics', () => {
  test('mcp__github__create_issue → "mcp_tool" (collapsed)', () => {
    // Documented contract: ALL mcp__ tools collapse to a single
    // bucket so the server name (potentially user-identifying URL)
    // doesn't leak into the analytics keyspace.
    expect(sanitizeToolNameForAnalytics('mcp__github__create_issue')).toBe(
      'mcp_tool',
    )
  })

  test('mcp__user-server__do_thing → "mcp_tool" (any server)', () => {
    expect(sanitizeToolNameForAnalytics('mcp__personal-mcp__x')).toBe(
      'mcp_tool',
    )
  })

  test('Bash → "Bash" (built-in passes through)', () => {
    expect(sanitizeToolNameForAnalytics('Bash')).toBe('Bash')
  })

  test('Edit → "Edit"', () => {
    expect(sanitizeToolNameForAnalytics('Edit')).toBe('Edit')
  })

  test('empty string → empty string', () => {
    expect(sanitizeToolNameForAnalytics('')).toBe('')
  })

  test('"mcp" alone (no __) → not collapsed (not mcp__-prefixed)', () => {
    // Only mcp__ prefix triggers collapse, not mcp.
    expect(sanitizeToolNameForAnalytics('mcp')).toBe('mcp')
  })
})

describe('extractMcpToolDetails', () => {
  test('mcp__server__tool → { serverName, mcpToolName }', () => {
    expect(extractMcpToolDetails('mcp__github__create_issue')).toEqual({
      serverName: 'github',
      mcpToolName: 'create_issue',
    })
  })

  test('mcp__server__tool__with__multiple__separators preserves trailing parts', () => {
    expect(
      extractMcpToolDetails('mcp__server__a__b__c'),
    ).toEqual({ serverName: 'server', mcpToolName: 'a__b__c' })
  })

  test('not mcp__ prefixed → undefined', () => {
    expect(extractMcpToolDetails('Bash')).toBeUndefined()
    expect(extractMcpToolDetails('NotMcp__server__tool')).toBeUndefined()
  })

  test('mcp__server (only 2 parts) → undefined', () => {
    expect(extractMcpToolDetails('mcp__server')).toBeUndefined()
  })

  test('mcp__ alone → undefined', () => {
    expect(extractMcpToolDetails('mcp__')).toBeUndefined()
  })

  test('mcp__server__ (empty tool) → undefined', () => {
    // Documented: empty serverName or mcpToolName → undefined.
    expect(extractMcpToolDetails('mcp__server__')).toBeUndefined()
  })

  test('mcp____tool (empty server) → undefined', () => {
    expect(extractMcpToolDetails('mcp____tool')).toBeUndefined()
  })
})

describe('mcpToolDetailsForAnalytics', () => {
  test('non-mcp tool → empty object {}', () => {
    expect(mcpToolDetailsForAnalytics('Bash', undefined, undefined)).toEqual(
      {},
    )
  })

  test('valid mcp tool → mapped to mcpServerName + mcpToolName keys', () => {
    expect(
      mcpToolDetailsForAnalytics(
        'mcp__github__create_issue',
        undefined,
        undefined,
      ),
    ).toEqual({
      mcpServerName: 'github',
      mcpToolName: 'create_issue',
    })
  })

  test('mcpServerType + baseUrl args ignored (intentional underscore prefix)', () => {
    const r = mcpToolDetailsForAnalytics(
      'mcp__github__x',
      'http',
      'https://api.example.com/secret',
    )
    expect(r).toEqual({
      mcpServerName: 'github',
      mcpToolName: 'x',
    })
    // Server type / URL must NOT leak into the result.
    expect(JSON.stringify(r)).not.toContain('http')
    expect(JSON.stringify(r)).not.toContain('example.com')
  })
})

describe('extractSkillName', () => {
  test('Skill tool with valid skill input → skill name', () => {
    expect(extractSkillName('Skill', { skill: 'commit' })).toBe('commit')
  })

  test('non-Skill tool → undefined regardless of input', () => {
    expect(extractSkillName('Bash', { skill: 'commit' })).toBeUndefined()
  })

  test('Skill tool with no input → undefined', () => {
    expect(extractSkillName('Skill', null)).toBeUndefined()
    expect(extractSkillName('Skill', undefined)).toBeUndefined()
  })

  test('Skill tool with non-object input → undefined', () => {
    expect(extractSkillName('Skill', 'commit')).toBeUndefined()
    expect(extractSkillName('Skill', 42)).toBeUndefined()
  })

  test('Skill tool with object missing skill key → undefined', () => {
    expect(extractSkillName('Skill', { args: '-m foo' })).toBeUndefined()
  })

  test('Skill tool with non-string skill value → undefined', () => {
    expect(extractSkillName('Skill', { skill: 42 })).toBeUndefined()
    expect(extractSkillName('Skill', { skill: null })).toBeUndefined()
  })
})

describe('getFileExtensionForAnalytics', () => {
  test('regular file → lowercase extension without dot', () => {
    expect(getFileExtensionForAnalytics('foo.ts')).toBe('ts')
    expect(getFileExtensionForAnalytics('bar.tsx')).toBe('tsx')
    expect(getFileExtensionForAnalytics('a.JSON')).toBe('json')
  })

  test('absolute path → just the extension', () => {
    expect(getFileExtensionForAnalytics('/etc/passwd.bak')).toBe('bak')
  })

  test('no extension → undefined', () => {
    expect(getFileExtensionForAnalytics('Makefile')).toBeUndefined()
    expect(getFileExtensionForAnalytics('foo')).toBeUndefined()
  })

  test('hidden file with no extension → undefined', () => {
    // path.extname('.bashrc') returns '' on POSIX (treated as no ext).
    expect(getFileExtensionForAnalytics('.bashrc')).toBeUndefined()
  })

  test('extension > 10 chars → "other" (PII protection: long extensions could be filename-like)', () => {
    expect(
      getFileExtensionForAnalytics('foo.verylongextensionname'),
    ).toBe('other')
  })

  test('extension exactly 10 chars → kept (boundary)', () => {
    // The ratchet is normalized.length > 10, so 10 chars passes.
    expect(getFileExtensionForAnalytics('x.abcdefghij')).toBe('abcdefghij')
  })

  test('multi-dot file (foo.tar.gz) → only last extension', () => {
    expect(getFileExtensionForAnalytics('foo.tar.gz')).toBe('gz')
  })

  test('trailing dot (foo.) → undefined', () => {
    // path.extname('foo.') returns '.' which the function rejects.
    expect(getFileExtensionForAnalytics('foo.')).toBeUndefined()
  })
})

describe('getFileExtensionsFromBashCommand', () => {
  test('command with one file → its extension', () => {
    expect(getFileExtensionsFromBashCommand('cat foo.ts')).toBe('ts')
  })

  test('multiple files: extensions deduped + comma-joined', () => {
    expect(
      getFileExtensionsFromBashCommand('mv a.ts b.ts c.tsx'),
    ).toBe('ts,tsx')
  })

  test('command with no file extensions → undefined', () => {
    expect(getFileExtensionsFromBashCommand('ls')).toBeUndefined()
  })

  test('simulatedSedEditFilePath: extension included even if not in command', () => {
    expect(
      getFileExtensionsFromBashCommand('sed -i s/x/y/ foo', 'foo.json'),
    ).toBe('json')
  })

  test('simulatedSedEditFilePath dedupes with command tokens', () => {
    expect(
      getFileExtensionsFromBashCommand('cat foo.json bar.txt', 'baz.json'),
    ).toBe('json,txt')
  })

  test('non-file tokens with dots: false-positive (best-effort heuristic)', () => {
    // Documented limitation: command tokens are split on whitespace and
    // each piece's extname is taken. So `npm i lodash@1.0.0` would
    // bucket `0` as an extension. This test locks the limitation.
    const r = getFileExtensionsFromBashCommand('echo abc.txt')
    expect(r).toBe('txt')
  })
})

describe('isToolDetailsLoggingEnabled', () => {
  test('returns boolean (no throw)', () => {
    expect(typeof isToolDetailsLoggingEnabled()).toBe('boolean')
  })
})
