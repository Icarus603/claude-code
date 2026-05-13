import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

import { CLIENT_REQUEST_ID_HEADER } from '../anthropic/client.ts'

/**
 * Pin buildFetch + CLIENT_REQUEST_ID_HEADER. The fetch wrapper injects
 * the x-client-request-id header so timeouts (which return no server
 * request ID) can still be correlated with server logs.
 *
 * CRITICAL: the injection is gated on firstParty + firstPartyAnthropicBaseUrl
 * — sending the header to Bedrock/Vertex/Foundry risks rejection from
 * strict proxies (inc-4029 class), and they don't log it anyway.
 */
describe('buildFetch + x-client-request-id', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'anthropic', 'client.ts'),
    'utf-8',
  )

  test('CLIENT_REQUEST_ID_HEADER = "x-client-request-id" (exact)', () => {
    expect(CLIENT_REQUEST_ID_HEADER).toBe('x-client-request-id')
  })

  const fnStart = source.indexOf('function buildFetch')
  const fnSlice = source.slice(fnStart, fnStart + 2000)

  test('injectClientRequestId gates on firstParty AND firstPartyAnthropicBaseUrl', () => {
    expect(fnSlice).toMatch(
      /injectClientRequestId =\s*\n?\s*getProviderHostBindings\(\)\.getAPIProvider\(\) === 'firstParty' &&\s*\n?\s*anthropic\.isFirstPartyAnthropicBaseUrl\(\)/,
    )
  })

  test('does NOT overwrite if caller pre-set the header (allow custom tracing)', () => {
    expect(fnSlice).toMatch(
      /if\s*\(injectClientRequestId && !headers\.has\(CLIENT_REQUEST_ID_HEADER\)\)/,
    )
  })

  test('uses randomUUID for client-generated request IDs', () => {
    expect(fnSlice).toMatch(/headers\.set\(CLIENT_REQUEST_ID_HEADER, randomUUID\(\)\)/)
  })

  test('debug log includes path + request ID + source', () => {
    expect(fnSlice).toMatch(
      /anthropic\.logForDebugging\(\s*\n?\s*`\[API REQUEST\] \$\{new URL\(url\)\.pathname\}[\s\S]*?\$\{CLIENT_REQUEST_ID_HEADER\}=\$\{id\}[\s\S]*?source=\$\{source \?\? 'unknown'\}`/,
    )
  })

  test('logging wrapped in try/catch so logging never crashes the fetch', () => {
    // CRITICAL defensive: log errors must not bubble up to caller (would
    // turn into "fetch failed" with a confusing log-related stack trace).
    expect(fnSlice).toMatch(/try\s*\{[\s\S]*?logForDebugging[\s\S]*?\}\s*catch\s*\{[\s\S]*?never let logging crash/)
  })

  test('falls back to globalThis.fetch when fetchOverride is undefined', () => {
    expect(fnSlice).toMatch(/const inner = fetchOverride \?\? globalThis\.fetch/)
  })
})
