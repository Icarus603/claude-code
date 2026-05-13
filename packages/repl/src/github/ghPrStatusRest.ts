/**
 * GitHub REST-based PR status — ported from ant v2.1.128 gZ7 (3672.js).
 *
 * Replaces the spawn-`gh pr view` path with a direct REST call. Benefits:
 *   - No process spawn per poll (~40ms per call on macOS).
 *   - Works on GitHub Enterprise via `GH_HOST` + `GH_ENTERPRISE_TOKEN`.
 *   - Honours `Last-Modified` / `ETag` so repeat polls return 304 with
 *     no payload (zero parse + zero network cost beyond the headers).
 *
 * Gated by `tengu_harbor_prism` — when off, callers fall back to the
 * spawn-gh path in ghPrStatus.ts. The two paths are interchangeable
 * (same return shape).
 */
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import { getGhAuthToken } from './ghAuthToken.js'

export type RestPrStatus = {
  number: number
  state: string
  title?: string
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  url: string
}

type CacheEntry = {
  etag?: string
  lastModified?: string
  body: RestPrStatus | null
  storedAt: number
}

const CACHE = new Map<string, CacheEntry>()

export function isHarborPrismEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_prism', false)
}

function getGhHost(): string {
  return process.env.GH_HOST ?? 'github.com'
}

function getApiBase(host: string): string {
  if (host === 'github.com') return 'https://api.github.com'
  return `https://${host}/api/v3`
}

/**
 * Fetch open PR for `<owner>/<repo>` matching `<owner>:<branch>` via the
 * GitHub REST `/pulls` endpoint. Returns null when no matching PR exists.
 * Throws on auth failure so the caller can surface the cause.
 */
export async function fetchPrStatusViaRest(input: {
  owner: string
  repo: string
  branch: string
}): Promise<RestPrStatus | null> {
  const host = getGhHost()
  const token = await getGhAuthToken(host)
  if (!token) {
    throw new Error('Harbor-prism: no gh auth token available')
  }
  const apiBase = getApiBase(host)
  const url = `${apiBase}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls?head=${encodeURIComponent(`${input.owner}:${input.branch}`)}&state=open&per_page=1`
  const cacheKey = `${host}:${input.owner}/${input.repo}#${input.branch}`
  const cached = CACHE.get(cacheKey)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'claude-code-harbor-prism',
  }
  if (cached?.etag) headers['If-None-Match'] = cached.etag
  if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified

  const res = await fetch(url, { method: 'GET', headers })
  if (res.status === 304 && cached) {
    return cached.body
  }
  if (!res.ok) {
    throw new Error(`Harbor-prism: GitHub returned ${res.status}`)
  }
  const arr = (await res.json()) as Array<{
    number: number
    state: string
    title?: string
    html_url: string
  }>
  const first = arr[0]
  let body: RestPrStatus | null = null
  if (first) {
    // /pulls?head=... does not include reviewDecision; populate as null
    // for now — callers that need it should hit the GraphQL endpoint
    // separately (ant does both calls for the same reason).
    body = {
      number: first.number,
      state: first.state,
      title: first.title,
      reviewDecision: null,
      url: first.html_url,
    }
  }
  CACHE.set(cacheKey, {
    etag: res.headers.get('etag') ?? undefined,
    lastModified: res.headers.get('last-modified') ?? undefined,
    body,
    storedAt: Date.now(),
  })
  return body
}

// (no test-reset seam exported until a test consumes it; CACHE is module-private)
