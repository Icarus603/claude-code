import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// Mock logEvent before importing SUT.
const realIndex = await import('../index.js')
let captured: Array<{ event: string; metadata: Record<string, unknown> }> = []

mock.module('../index.js', () => ({
  ...realIndex,
  logEvent: (
    event: string,
    metadata: Record<string, unknown>,
  ): void => {
    captured.push({ event, metadata })
  },
}))

const { logFileOperation } = await import('../fileOperationAnalytics.js')

beforeEach(() => {
  captured = []
})

describe('logFileOperation — basic event shape', () => {
  test('emits "tengu_file_operation" event', () => {
    logFileOperation({
      operation: 'read',
      tool: 'FileReadTool',
      filePath: '/some/path.ts',
    })
    expect(captured[0]?.event).toBe('tengu_file_operation')
  })

  test('metadata always carries operation, tool, filePathHash', () => {
    logFileOperation({
      operation: 'write',
      tool: 'FileWriteTool',
      filePath: '/x.ts',
    })
    expect(captured[0]?.metadata).toEqual({
      operation: 'write',
      tool: 'FileWriteTool',
      filePathHash: expect.any(String),
    })
  })

  test('contentHash present when content provided', () => {
    logFileOperation({
      operation: 'write',
      tool: 'FileWriteTool',
      filePath: '/x.ts',
      content: 'hello',
    })
    expect(captured[0]?.metadata.contentHash).toBeDefined()
  })

  test('contentHash absent when content not provided', () => {
    logFileOperation({
      operation: 'read',
      tool: 'FileReadTool',
      filePath: '/x.ts',
    })
    expect(captured[0]?.metadata.contentHash).toBeUndefined()
  })

  test('type field forwarded when provided', () => {
    logFileOperation({
      operation: 'write',
      tool: 'FileWriteTool',
      filePath: '/x.ts',
      type: 'create',
    })
    expect(captured[0]?.metadata.type).toBe('create')
  })

  test('type field absent when not provided', () => {
    logFileOperation({
      operation: 'edit',
      tool: 'FileEditTool',
      filePath: '/x.ts',
    })
    expect(captured[0]?.metadata.type).toBeUndefined()
  })
})

describe('logFileOperation — privacy: filePathHash', () => {
  test('hash is 16 hex chars (truncated sha256)', () => {
    logFileOperation({
      operation: 'read',
      tool: 'FileReadTool',
      filePath: '/some/sensitive/path.ts',
    })
    const hash = captured[0]?.metadata.filePathHash as string
    expect(hash).toHaveLength(16)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  test('same path → same hash (deterministic)', () => {
    logFileOperation({
      operation: 'read',
      tool: 'FileReadTool',
      filePath: '/same/path',
    })
    logFileOperation({
      operation: 'read',
      tool: 'FileReadTool',
      filePath: '/same/path',
    })
    expect(captured[0]?.metadata.filePathHash).toBe(
      captured[1]?.metadata.filePathHash as string,
    )
  })

  test('different paths → different hashes (collision-resistant)', () => {
    logFileOperation({
      operation: 'read',
      tool: 'FileReadTool',
      filePath: '/a',
    })
    logFileOperation({
      operation: 'read',
      tool: 'FileReadTool',
      filePath: '/b',
    })
    expect(captured[0]?.metadata.filePathHash).not.toBe(
      captured[1]?.metadata.filePathHash as string,
    )
  })

  test('does NOT log raw filePath in metadata (privacy guarantee)', () => {
    // CRITICAL: the comment "Used for privacy-preserving analytics" is
    // load-bearing. If a future refactor adds the raw path back, sensitive
    // file names (e.g. ~/Documents/secrets.txt) would leak to telemetry.
    logFileOperation({
      operation: 'read',
      tool: 'FileReadTool',
      filePath: '/secret/credentials.json',
    })
    const m = captured[0]?.metadata
    expect(m?.filePath).toBeUndefined()
    expect(JSON.stringify(m)).not.toContain('credentials.json')
  })
})

describe('logFileOperation — contentHash', () => {
  test('hash is 64 hex chars (full sha256)', () => {
    logFileOperation({
      operation: 'write',
      tool: 'FileWriteTool',
      filePath: '/x.ts',
      content: 'short',
    })
    const hash = captured[0]?.metadata.contentHash as string
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('same content → same hash (deduplication contract)', () => {
    // The hash is used for "deduplication and change detection".
    // Same content must hash identically across calls.
    logFileOperation({
      operation: 'write',
      tool: 'FileWriteTool',
      filePath: '/a.ts',
      content: 'hello world',
    })
    logFileOperation({
      operation: 'write',
      tool: 'FileWriteTool',
      filePath: '/b.ts', // different path
      content: 'hello world', // same content
    })
    // Same content → same contentHash (regardless of path).
    expect(captured[0]?.metadata.contentHash).toBe(
      captured[1]?.metadata.contentHash as string,
    )
    // Different paths → different filePathHash.
    expect(captured[0]?.metadata.filePathHash).not.toBe(
      captured[1]?.metadata.filePathHash as string,
    )
  })

  test('empty string content produces sha256 of empty string', () => {
    logFileOperation({
      operation: 'write',
      tool: 'FileWriteTool',
      filePath: '/x.ts',
      content: '',
    })
    // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(captured[0]?.metadata.contentHash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  test('content at exactly 100KB is hashed (boundary inclusive)', () => {
    // MAX_CONTENT_HASH_SIZE = 100 * 1024. The check is `<=`, so 100KB
    // exactly should still hash.
    const MAX = 100 * 1024
    const content = 'x'.repeat(MAX)
    logFileOperation({
      operation: 'write',
      tool: 'FileWriteTool',
      filePath: '/x.ts',
      content,
    })
    expect(captured[0]?.metadata.contentHash).toBeDefined()
  })

  test('content over 100KB is NOT hashed (memory protection)', () => {
    // Critical: hashing a 1MB base64-encoded image would block the event
    // loop. The cap protects the hot path. Over-cap → no contentHash.
    const content = 'x'.repeat(100 * 1024 + 1)
    logFileOperation({
      operation: 'write',
      tool: 'FileWriteTool',
      filePath: '/x.ts',
      content,
    })
    expect(captured[0]?.metadata.contentHash).toBeUndefined()
  })
})

describe('logFileOperation — operation/tool/type pass-through', () => {
  test('all 3 operations propagate', () => {
    logFileOperation({ operation: 'read', tool: 'FileReadTool', filePath: '/x' })
    logFileOperation({ operation: 'write', tool: 'FileWriteTool', filePath: '/x' })
    logFileOperation({ operation: 'edit', tool: 'FileEditTool', filePath: '/x' })
    expect(captured.map(c => c.metadata.operation)).toEqual([
      'read',
      'write',
      'edit',
    ])
  })

  test('all 3 tools propagate', () => {
    logFileOperation({ operation: 'read', tool: 'FileReadTool', filePath: '/x' })
    logFileOperation({ operation: 'write', tool: 'FileWriteTool', filePath: '/x' })
    logFileOperation({ operation: 'edit', tool: 'FileEditTool', filePath: '/x' })
    expect(captured.map(c => c.metadata.tool)).toEqual([
      'FileReadTool',
      'FileWriteTool',
      'FileEditTool',
    ])
  })

  test('both type values propagate', () => {
    logFileOperation({
      operation: 'write',
      tool: 'FileWriteTool',
      filePath: '/x',
      type: 'create',
    })
    logFileOperation({
      operation: 'edit',
      tool: 'FileEditTool',
      filePath: '/x',
      type: 'update',
    })
    expect(captured.map(c => c.metadata.type)).toEqual(['create', 'update'])
  })
})
