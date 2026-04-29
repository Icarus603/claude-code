import { mock, describe, expect, test, afterEach } from 'bun:test'

// Spread real exports + override only what this test needs.
// mock.module() applies globally to the whole bun test process; an
// incomplete mock silently shadows the real module for unrelated tests.
// See feedback_bun_mock_module_global_scope.md.
const realDebug = await import('@claude-code/local-observability/debug.js')

mock.module('axios', () => ({
  default: { get: async () => ({ data: { servers: [] } }) },
}))
mock.module('@claude-code/local-observability/debug.js', () => ({
  ...realDebug,
  logForDebugging: () => {},
}))
mock.module('src/utils/errors.js', () => ({
  errorMessage: (e: any) => String(e),
}))

const { isOfficialMcpUrl, resetOfficialMcpUrlsForTesting } = await import(
  '@claude-code/mcp-runtime/officialRegistry'
)

describe('isOfficialMcpUrl', () => {
  afterEach(() => {
    resetOfficialMcpUrlsForTesting()
  })

  test('returns false when registry not loaded (initial state)', () => {
    resetOfficialMcpUrlsForTesting()
    expect(isOfficialMcpUrl('https://example.com')).toBe(false)
  })

  test('returns false for non-registered URL', () => {
    expect(isOfficialMcpUrl('https://random-server.com/mcp')).toBe(false)
  })

  test('returns false for empty string', () => {
    expect(isOfficialMcpUrl('')).toBe(false)
  })
})

describe('resetOfficialMcpUrlsForTesting', () => {
  test('can be called without error', () => {
    expect(() => resetOfficialMcpUrlsForTesting()).not.toThrow()
  })

  test('clears state so subsequent lookups return false', () => {
    resetOfficialMcpUrlsForTesting()
    expect(isOfficialMcpUrl('https://anything.com')).toBe(false)
  })
})
