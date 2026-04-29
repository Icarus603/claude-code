import { describe, expect, test } from 'bun:test'
import { parseSessionIdentifier } from '../sessionUrl.js'

describe('parseSessionIdentifier — JSONL file paths', () => {
  // Critical contract: JSONL files are checked BEFORE URL parsing.
  // Without this ordering, Windows absolute paths like C:\path\file.jsonl
  // would parse as URLs (C: as protocol).

  test('plain .jsonl filename → isJsonlFile=true', () => {
    const r = parseSessionIdentifier('session.jsonl')
    expect(r?.isJsonlFile).toBe(true)
    expect(r?.jsonlFile).toBe('session.jsonl')
    expect(r?.isUrl).toBe(false)
    expect(r?.ingressUrl).toBeNull()
  })

  test('absolute Unix path .jsonl → isJsonlFile=true', () => {
    const r = parseSessionIdentifier('/users/me/session.jsonl')
    expect(r?.isJsonlFile).toBe(true)
    expect(r?.jsonlFile).toBe('/users/me/session.jsonl')
  })

  test('CRITICAL — Windows path C:\\path\\file.jsonl is JSONL (not URL)', () => {
    // Without the early-jsonl-check, "C:" would parse as URL protocol.
    const r = parseSessionIdentifier('C:\\path\\file.jsonl')
    expect(r?.isJsonlFile).toBe(true)
    expect(r?.isUrl).toBe(false)
  })

  test('uppercase .JSONL also recognized (case-insensitive)', () => {
    expect(parseSessionIdentifier('SESSION.JSONL')?.isJsonlFile).toBe(true)
  })

  test('mixed-case .jSoNl also recognized', () => {
    expect(parseSessionIdentifier('session.jSoNl')?.isJsonlFile).toBe(true)
  })

  test('JSONL path generates a fresh sessionId (random, not from filename)', () => {
    const r1 = parseSessionIdentifier('a.jsonl')
    const r2 = parseSessionIdentifier('a.jsonl')
    expect(r1?.sessionId).not.toBe(r2?.sessionId)
  })

  test('JSONL sessionId is a valid UUID format', () => {
    const r = parseSessionIdentifier('test.jsonl')
    expect(r?.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })
})

describe('parseSessionIdentifier — UUID', () => {
  test('valid UUID → sessionId echoed back', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const r = parseSessionIdentifier(uuid)
    expect(r?.sessionId).toBe(uuid)
    expect(r?.isUrl).toBe(false)
    expect(r?.isJsonlFile).toBe(false)
    expect(r?.ingressUrl).toBeNull()
    expect(r?.jsonlFile).toBeNull()
  })

  test('uppercase UUID accepted', () => {
    const uuid = '550E8400-E29B-41D4-A716-446655440000'
    const r = parseSessionIdentifier(uuid)
    expect(r?.sessionId).toBe(uuid)
  })

  test('UUID without hyphens is NOT recognized (would need separate handling)', () => {
    // validateUuid requires hyphens. 32-char hex without dashes → falls
    // through to URL parse → fails → returns null.
    expect(
      parseSessionIdentifier('550e8400e29b41d4a716446655440000'),
    ).toBeNull()
  })

  test('truncated UUID → null', () => {
    expect(parseSessionIdentifier('550e8400-e29b-41d4-a716')).toBeNull()
  })
})

describe('parseSessionIdentifier — URL', () => {
  test('https URL → isUrl=true with full URL captured', () => {
    const url = 'https://api.example.com/v1/session_ingress/abc'
    const r = parseSessionIdentifier(url)
    expect(r?.isUrl).toBe(true)
    expect(r?.ingressUrl).toBe(url)
    expect(r?.isJsonlFile).toBe(false)
    expect(r?.jsonlFile).toBeNull()
  })

  test('http URL accepted', () => {
    const r = parseSessionIdentifier('http://localhost:8080/session/x')
    expect(r?.isUrl).toBe(true)
    expect(r?.ingressUrl).toBe('http://localhost:8080/session/x')
  })

  test('URL generates fresh sessionId (random, not from URL)', () => {
    const url = 'https://example.com/session/x'
    const r1 = parseSessionIdentifier(url)
    const r2 = parseSessionIdentifier(url)
    expect(r1?.sessionId).not.toBe(r2?.sessionId)
  })

  test('URL sessionId is a valid UUID', () => {
    const r = parseSessionIdentifier('https://example.com/session/x')
    expect(r?.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  test('URL with query string + fragment preserved in ingressUrl', () => {
    const url = 'https://example.com/session?id=123&token=xyz#anchor'
    const r = parseSessionIdentifier(url)
    expect(r?.ingressUrl).toBe(url)
  })

  test('URL.href normalizes input (e.g., default port stripped)', () => {
    // new URL('https://example.com:443/x').href = 'https://example.com/x'
    // Document the URL.href normalization.
    const r = parseSessionIdentifier('https://example.com:443/x')
    expect(r?.ingressUrl).toBe('https://example.com/x')
  })
})

describe('parseSessionIdentifier — invalid inputs', () => {
  test('plain text → null', () => {
    expect(parseSessionIdentifier('not a session')).toBeNull()
  })

  test('empty string → null', () => {
    expect(parseSessionIdentifier('')).toBeNull()
  })

  test('whitespace-only → null', () => {
    expect(parseSessionIdentifier('   ')).toBeNull()
  })

  test('almost-UUID with wrong-length segment → null', () => {
    // 9 hex chars in last segment instead of 12.
    expect(
      parseSessionIdentifier('550e8400-e29b-41d4-a716-44665544000'),
    ).toBeNull()
  })

  test('URL-like with no protocol → null (URL parsing requires scheme)', () => {
    expect(parseSessionIdentifier('example.com/session')).toBeNull()
  })
})

describe('parseSessionIdentifier — branch ordering', () => {
  // Order is: jsonl check → UUID check → URL parse → null.
  // Verify the ordering produces correct results for ambiguous cases.

  test('UUID with .jsonl suffix prioritizes JSONL branch', () => {
    // A real-world UUID-as-filename pattern: the file is called
    // <uuid>.jsonl. JSONL branch wins.
    const fname = '550e8400-e29b-41d4-a716-446655440000.jsonl'
    const r = parseSessionIdentifier(fname)
    expect(r?.isJsonlFile).toBe(true)
    expect(r?.jsonlFile).toBe(fname)
    expect(r?.isUrl).toBe(false)
  })
})
