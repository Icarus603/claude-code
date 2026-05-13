/**
 * Gateway model discovery — byte-for-byte port of ant v2.1.136
 * 4137.js (`wY6` module) + 4138.js (`Dh8` cache schema):
 *   - `ZHK` → isGatewayModelDiscoveryEnabled
 *   - `LHK` / `kHK` → cacheDir / cachePath
 *   - `Jh8` → memoised cache reader (path → parsed | null)
 *   - `JK3` → cache schema: `{baseUrl, fetchedAt, models}`
 *   - `RHK` → model schema: `{id, display_name?}` strip
 *   - `VHK` → readCachedGatewayModels (sync, returns SelectOption[])
 *   - `NHK` → refreshGatewayModels (async, writes when baseUrl or
 *     model set actually changed)
 *
 * Cache structure was `{data: models}` in the old ccb impl which lost the
 * `baseUrl` discriminator — switching gateways kept serving stale models
 * from the old gateway. Ant explicitly tags cache with the baseUrl AND
 * compares it on read so stale data is invisible.
 *
 * Eligibility chain (ant `ZHK`):
 *   - `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` env truthy
 *   - getAPIProvider() === 'firstParty'
 *   - !isFirstPartyAnthropicBaseUrl() — must be a custom gateway
 *   - ANTHROPIC_BASE_URL must be set
 *
 * Auth precedence (ant `NHK`):
 *   - `ANTHROPIC_AUTH_TOKEN` env → `Authorization: Bearer …`
 *   - else `getAnthropicApiKey()` → `x-api-key: …`
 *   - if neither → return early (no fetch)
 *
 * NOT used:
 *   - OAuth tokens — ant never falls back to OAuth for gateway discovery
 *     because the gateway is a custom auth endpoint that wouldn't accept
 *     claude.ai bearer tokens anyway.
 *
 * Extra headers (ant `NHK`):
 *   - parses `ANTHROPIC_CUSTOM_HEADERS` (multi-line `Name: Value`) and
 *     applies on top of the standard ones — same parser used in
 *     anthropic/client.ts:getCustomHeaders.
 *
 * Safety:
 *   - `redirect: 'error'` — refuse to follow redirects.
 *   - `AbortSignal.timeout(3000)` — 3-second hard timeout.
 *   - Zod-style schema validation before persisting.
 *   - `isEssentialTrafficOnly()` opt-out (HIPAA orgs).
 */
import { existsSync, readFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  getClaudeConfigHomeDir,
  isEnvTruthy,
} from '@claude-code/config/env/utils'
import { readEnv } from '@claude-code/config/env'
import { isEssentialTrafficOnly } from '@claude-code/config/env/privacy-level'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { jsonStringify } from '@claude-code/local-observability/slowOperations.js'
import { safeParseJSON } from '@claude-code/storage/json.js'
import { getUserAgent } from './http.js'
import { getAnthropicApiKey } from './authAlias.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from './providers.js'

/** Ant `wK3` */
const ABORT_TIMEOUT_MS = 3000

/** Ant model schema `RHK` — strip mode (extra keys are dropped). */
export type GatewayModel = {
  id: string
  display_name?: string
}

/** Ant cache schema `JK3`. */
type GatewayModelCache = {
  baseUrl: string
  fetchedAt: number
  models: GatewayModel[]
}

/** Ant model-picker option shape — returned by `VHK`. */
export type GatewayModelOption = {
  value: string
  label: string
  description: 'From gateway'
}

function getCacheDir(): string {
  return join(getClaudeConfigHomeDir(), 'cache')
}

function getCachePath(): string {
  return join(getCacheDir(), 'gateway-models.json')
}

/**
 * Ant `Jh8`. Memoised path → parsed-cache reader. Ant memoises by `path`
 * for the lifetime of the process; here we use a plain map keyed by
 * path. Re-fetch invalidates the entry via `clearCacheForTesting`.
 */
const cacheReaderMemo = new Map<string, GatewayModelCache | null>()

function readCacheFromDisk(path: string): GatewayModelCache | null {
  if (cacheReaderMemo.has(path)) return cacheReaderMemo.get(path)!
  let parsed: GatewayModelCache | null = null
  try {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf-8')
      const value: unknown = safeParseJSON(raw, false)
      parsed = validateGatewayModelCache(value)
    }
  } catch {
    parsed = null
  }
  cacheReaderMemo.set(path, parsed)
  return parsed
}

function validateGatewayModelCache(value: unknown): GatewayModelCache | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Partial<GatewayModelCache>
  if (typeof v.baseUrl !== 'string') return null
  if (typeof v.fetchedAt !== 'number') return null
  if (!Array.isArray(v.models)) return null
  for (const m of v.models) {
    if (typeof m !== 'object' || m === null) return null
    if (typeof (m as GatewayModel).id !== 'string') return null
    const dn = (m as GatewayModel).display_name
    if (dn !== undefined && typeof dn !== 'string') return null
  }
  return v as GatewayModelCache
}

function _clearCacheReaderMemoForTesting(): void {
  cacheReaderMemo.clear()
}

/**
 * Ant `ZHK`. Eligibility predicate — see header comment for the chain.
 * Critical order: env truthy is checked FIRST so disabled installations
 * never touch the auth / provider helpers (which would log debug noise).
 */
export function isGatewayModelDiscoveryEnabled(): boolean {
  if (!isEnvTruthy(readEnv('CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY'))) {
    return false
  }
  if (getAPIProvider() !== 'firstParty') return false
  // Ant `Ez()` = `isFirstPartyAnthropicBaseUrl()`. The canonical
  // api.anthropic.com endpoint exposes models via the SDK; gateway
  // discovery is for custom base URLs only.
  if (isFirstPartyAnthropicBaseUrl()) return false
  if (!readEnv('ANTHROPIC_BASE_URL')) return false
  return true
}

/**
 * Ant `VHK`. Read cached gateway models AT model-picker render time. Returns
 * picker options (`{value, label, description: 'From gateway'}`) and
 * EMPTIES OUT the result when the cached `baseUrl` doesn't match the
 * currently-configured `ANTHROPIC_BASE_URL` — so a user who switches
 * gateways doesn't see stale models from the previous one.
 */
export function readCachedGatewayModels(): GatewayModelOption[] {
  if (!isGatewayModelDiscoveryEnabled()) return []
  const cache = readCacheFromDisk(getCachePath())
  if (!cache) return []
  if (cache.baseUrl !== readEnv('ANTHROPIC_BASE_URL')) return []
  return cache.models.map(m => ({
    value: m.id,
    label: m.display_name || m.id,
    description: 'From gateway' as const,
  }))
}

/**
 * Raw read for callers that need the underlying model list (auth flows,
 * connection setup) rather than picker options. Mirrors `Jh8(kHK())`
 * direct usage in ant.
 */
export function readCachedGatewayModelList(): GatewayModel[] {
  if (!isGatewayModelDiscoveryEnabled()) return []
  const cache = readCacheFromDisk(getCachePath())
  if (!cache) return []
  if (cache.baseUrl !== readEnv('ANTHROPIC_BASE_URL')) return []
  return cache.models.slice()
}

/**
 * Ant `getCustomHeaders` (anthropic/client.ts) — parse multi-line
 * `Name: Value` from `ANTHROPIC_CUSTOM_HEADERS`. Duplicated here as a
 * pure helper to avoid the anthropic/client import (which transitively
 * pulls the whole client tree).
 */
function parseCustomHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const raw = readEnv('ANTHROPIC_CUSTOM_HEADERS')
  if (!raw) return headers
  for (const line of raw.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':')
    if (colonIdx <= 0) continue
    const name = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    if (name && value) headers[name] = value
  }
  return headers
}

function arraysShallowEqual(a: GatewayModel[], b: GatewayModel[]): boolean {
  // Ant `nz` is a general deep-equal; for our case the cache shape is
  // fixed (id + optional display_name) so a hand-rolled check is enough.
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.id !== b[i]!.id) return false
    if (a[i]!.display_name !== b[i]!.display_name) return false
  }
  return true
}

/**
 * Ant `NHK` (4137.js). Fetch gateway models and update the cache when
 * the model set actually changed. Returns silently on:
 *   - gate disabled
 *   - essential-traffic-only mode on
 *   - missing auth (no ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY)
 *   - non-2xx response
 *   - schema validation failure
 *   - empty filtered list
 *
 * The write-conditional is `cache?.baseUrl !== currentBase ||
 * !arraysShallowEqual(cache.models, fresh)` — if both match we skip the
 * write entirely. This keeps mtime stable so other tools (file-watchers,
 * doctor) don't false-alarm on a no-op refresh.
 *
 * Returns nothing because callers don't need the list; readers go
 * through `readCachedGatewayModels` after the cache is up to date.
 */
export async function refreshGatewayModels(): Promise<void> {
  if (!isGatewayModelDiscoveryEnabled()) return
  if (isEssentialTrafficOnly()) return
  const base = readEnv('ANTHROPIC_BASE_URL')
  if (!base) return

  // Ant order: ANTHROPIC_AUTH_TOKEN takes precedence over the API key.
  const authToken = readEnv('ANTHROPIC_AUTH_TOKEN')
  const apiKey = authToken ? null : getAnthropicApiKey()
  if (!authToken && !apiKey) return

  const url = `${base.replace(/\/+$/, '')}/v1/models?limit=1000`
  const customHeaders = parseCustomHeaders()
  const headers: Record<string, string> = {
    ...(authToken
      ? { Authorization: `Bearer ${authToken}` }
      : { 'x-api-key': apiKey! }),
    'anthropic-version': '2023-06-01',
    'User-Agent': getUserAgent(),
    ...customHeaders,
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(ABORT_TIMEOUT_MS),
    })
  } catch (e) {
    logForDebugging(
      `[gatewayDiscovery] fetch failed: ${e instanceof Error ? e.message : 'unknown'}`,
    )
    return
  }

  if (!response.ok) {
    logForDebugging(`[gatewayDiscovery] non-OK status ${response.status}`)
    return
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (e) {
    logForDebugging(
      `[gatewayDiscovery] response body parse failed: ${
        e instanceof Error ? e.message : 'unknown'
      }`,
    )
    return
  }

  if (typeof body !== 'object' || body === null) {
    logForDebugging('[gatewayDiscovery] response body failed validation')
    return
  }
  const data = (body as { data?: unknown }).data
  if (!Array.isArray(data)) {
    logForDebugging('[gatewayDiscovery] response body failed validation')
    return
  }

  const validated: GatewayModel[] = []
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue
    const id = (item as { id?: unknown }).id
    if (typeof id !== 'string') continue
    const dn = (item as { display_name?: unknown }).display_name
    validated.push({
      id,
      ...(typeof dn === 'string' ? { display_name: dn } : {}),
    })
  }

  const filtered = validated.filter(m => /^(claude|anthropic)/i.test(m.id))
  if (filtered.length === 0) {
    logForDebugging('[gatewayDiscovery] 0 usable models after filter')
    return
  }

  const path = getCachePath()
  const cached = readCacheFromDisk(path)
  if (
    cached &&
    cached.baseUrl === base &&
    arraysShallowEqual(cached.models, filtered)
  ) {
    // No-op refresh — nothing changed, skip the write to keep mtime stable.
    return
  }

  try {
    await mkdir(getCacheDir(), { recursive: true })
    await writeFile(
      path,
      jsonStringify({
        baseUrl: base,
        fetchedAt: Date.now(),
        models: filtered,
      } satisfies GatewayModelCache),
      { encoding: 'utf-8', mode: 0o600 },
    )
    // Invalidate the memo so the next read sees the fresh content.
    cacheReaderMemo.delete(path)
    logForDebugging(`[gatewayDiscovery] cached ${filtered.length} models`)
  } catch (e) {
    logForDebugging(
      `[gatewayDiscovery] cache write failed: ${
        e instanceof Error ? e.message : 'unknown'
      }`,
    )
  }
}

// Test-only invalidator export — accessed via `_resetForTesting` so it
// can't be re-bound at runtime by anything other than tests.
export const _resetForTesting = {
  clearCache: _clearCacheReaderMemoForTesting,
}
