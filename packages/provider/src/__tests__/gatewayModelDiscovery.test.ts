/**
 * Tests for gatewayModelDiscovery.ts — byte-for-byte port-correctness
 * against ant v2.1.136 4137.js (`wY6`) + 4138.js (`Dh8`).
 *
 * Pin:
 *   - `ZHK` eligibility chain (env-truthy first, then provider, then
 *     base URL discrimination)
 *   - cache schema `{baseUrl, fetchedAt, models}` (not `{data}`)
 *   - baseUrl mismatch invalidates cached read (no stale leak when
 *     switching gateways)
 *   - readCachedGatewayModels returns picker-shaped options with
 *     description: 'From gateway' (ant `VHK`)
 *
 * The async `refreshGatewayModels` fetch path goes through `fetch` which
 * isn't cleanly mockable in bun:test. These unit tests pin the SYNC
 * read-side contracts plus the eligibility predicate.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as realProviders from '../providers.js'
import * as realAuth from '../authAlias.js'

// Mock the helpers that touch host bindings so tests don't need a full
// app-host bootstrap. Default to firstParty + no special base URL, so
// the eligibility predicate is reachable in tests.
let mockedAPIProvider: 'firstParty' | 'bedrock' | 'vertex' | 'openai' =
  'firstParty'
let mockedIsFirstPartyBaseUrl = false
let mockedApiKey: string | null = 'test-api-key'

mock.module('../providers.js', () => ({
  ...realProviders,
  getAPIProvider: () => mockedAPIProvider,
  isFirstPartyAnthropicBaseUrl: () => mockedIsFirstPartyBaseUrl,
}))

mock.module('../authAlias.js', () => ({
  ...realAuth,
  getAnthropicApiKey: () => mockedApiKey,
  getAnthropicApiKeyWithSource: () => ({
    key: mockedApiKey,
    source: 'ANTHROPIC_API_KEY',
  }),
  getClaudeAIOAuthTokens: () => null,
}))

let claudeHome: string
const ORIG_ENV: Record<string, string | undefined> = {}

function backup(name: string): void {
  ORIG_ENV[name] = process.env[name]
}
function restore(): void {
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

beforeEach(() => {
  for (const k of [
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_API_KEY',
  ]) {
    backup(k)
    delete process.env[k]
  }
  claudeHome = mkdtempSync(join(tmpdir(), 'ccb-gw-test-'))
  process.env.CLAUDE_CONFIG_DIR = claudeHome
})

afterEach(() => {
  restore()
  rmSync(claudeHome, { recursive: true, force: true })
})

async function freshImport(): Promise<typeof import('../gatewayModelDiscovery.js')> {
  // Cache reader memoises; clear before each test so writes persist.
  const mod = await import('../gatewayModelDiscovery.js')
  mod._resetForTesting.clearCache()
  return mod
}

function writeCacheFile(payload: unknown): void {
  const dir = join(claudeHome, 'cache')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'gateway-models.json'),
    JSON.stringify(payload),
    'utf8',
  )
}

describe('isGatewayModelDiscoveryEnabled (ant ZHK)', () => {
  test('returns false when env-flag is missing', async () => {
    const m = await freshImport()
    process.env.ANTHROPIC_BASE_URL = 'https://gw.example/v1'
    expect(m.isGatewayModelDiscoveryEnabled()).toBe(false)
  })

  test('returns false when env-flag is falsy', async () => {
    const m = await freshImport()
    process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '0'
    process.env.ANTHROPIC_BASE_URL = 'https://gw.example/v1'
    expect(m.isGatewayModelDiscoveryEnabled()).toBe(false)
  })

  test('returns false when ANTHROPIC_BASE_URL is missing', async () => {
    const m = await freshImport()
    process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1'
    expect(m.isGatewayModelDiscoveryEnabled()).toBe(false)
  })
})

describe('readCachedGatewayModels (ant VHK)', () => {
  test('returns [] when discovery is disabled', async () => {
    writeCacheFile({
      baseUrl: 'https://gw.example/v1',
      fetchedAt: 0,
      models: [{ id: 'claude-foo' }],
    })
    const m = await freshImport()
    // env flag not set → disabled
    expect(m.readCachedGatewayModels()).toEqual([])
  })

  test('returns [] when no cache file exists', async () => {
    process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1'
    process.env.ANTHROPIC_BASE_URL = 'https://gw.example/v1'
    const m = await freshImport()
    expect(m.readCachedGatewayModels()).toEqual([])
  })

  test('returns models when baseUrl matches', async () => {
    process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1'
    process.env.ANTHROPIC_BASE_URL = 'https://gw.example/v1'
    writeCacheFile({
      baseUrl: 'https://gw.example/v1',
      fetchedAt: Date.now(),
      models: [
        { id: 'claude-foo', display_name: 'Foo' },
        { id: 'anthropic-bar' },
      ],
    })
    const m = await freshImport()
    const got = m.readCachedGatewayModels()
    expect(got).toEqual([
      { value: 'claude-foo', label: 'Foo', description: 'From gateway' },
      {
        value: 'anthropic-bar',
        label: 'anthropic-bar',
        description: 'From gateway',
      },
    ])
  })

  test('returns [] when cached baseUrl mismatches current env', async () => {
    // CRITICAL: ant explicitly tags the cache with baseUrl so switching
    // gateways doesn't leak stale models from the previous one.
    process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1'
    process.env.ANTHROPIC_BASE_URL = 'https://NEW-gateway.example/v1'
    writeCacheFile({
      baseUrl: 'https://OLD-gateway.example/v1',
      fetchedAt: Date.now(),
      models: [{ id: 'claude-stale' }],
    })
    const m = await freshImport()
    expect(m.readCachedGatewayModels()).toEqual([])
  })

  test('returns [] when cache file is missing required fields (schema fail)', async () => {
    process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1'
    process.env.ANTHROPIC_BASE_URL = 'https://gw.example/v1'
    // Old ccb shape `{data: models}` lacks baseUrl + fetchedAt → invalid.
    writeCacheFile({ data: [{ id: 'claude-foo' }] })
    const m = await freshImport()
    expect(m.readCachedGatewayModels()).toEqual([])
  })

  test('returns [] when cache file is malformed JSON', async () => {
    process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1'
    process.env.ANTHROPIC_BASE_URL = 'https://gw.example/v1'
    const dir = join(claudeHome, 'cache')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'gateway-models.json'), '{ not json', 'utf8')
    const m = await freshImport()
    expect(m.readCachedGatewayModels()).toEqual([])
  })

  test('falls back to model.id when display_name absent (ant VHK label)', async () => {
    process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1'
    process.env.ANTHROPIC_BASE_URL = 'https://gw.example/v1'
    writeCacheFile({
      baseUrl: 'https://gw.example/v1',
      fetchedAt: Date.now(),
      models: [{ id: 'claude-named' }],
    })
    const m = await freshImport()
    expect(m.readCachedGatewayModels()[0]).toEqual({
      value: 'claude-named',
      label: 'claude-named',
      description: 'From gateway',
    })
  })
})

describe('readCachedGatewayModelList (auth/connection raw read)', () => {
  test('returns model list when cache valid', async () => {
    process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1'
    process.env.ANTHROPIC_BASE_URL = 'https://gw.example/v1'
    writeCacheFile({
      baseUrl: 'https://gw.example/v1',
      fetchedAt: Date.now(),
      models: [{ id: 'claude-foo' }, { id: 'anthropic-bar' }],
    })
    const m = await freshImport()
    expect(m.readCachedGatewayModelList()).toEqual([
      { id: 'claude-foo' },
      { id: 'anthropic-bar' },
    ])
  })

  test('returns [] when baseUrl mismatches', async () => {
    process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1'
    process.env.ANTHROPIC_BASE_URL = 'https://different.example/v1'
    writeCacheFile({
      baseUrl: 'https://gw.example/v1',
      fetchedAt: Date.now(),
      models: [{ id: 'claude-foo' }],
    })
    const m = await freshImport()
    expect(m.readCachedGatewayModelList()).toEqual([])
  })
})
