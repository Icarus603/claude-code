import { describe, expect, test } from 'bun:test'
import { buildConsolidationPrompt } from '../consolidationPrompt.js'

describe('buildConsolidationPrompt — interpolation', () => {
  test('memoryRoot placeholder is filled', () => {
    const result = buildConsolidationPrompt(
      '/users/me/memory',
      '/proj/sessions',
      '',
    )
    expect(result).toContain('`/users/me/memory`')
  })

  test('transcriptDir placeholder is filled', () => {
    const result = buildConsolidationPrompt(
      '/mem',
      '/users/me/.claude/projects/myproj',
      '',
    )
    expect(result).toContain('/users/me/.claude/projects/myproj')
  })

  test('transcriptDir interpolated into the grep example', () => {
    const result = buildConsolidationPrompt('/m', '/transcripts/here', '')
    expect(result).toContain('/transcripts/here/')
    expect(result).toContain('grep -rn')
  })
})

describe('buildConsolidationPrompt — extra context', () => {
  // Critical contract: extra is interpolated CONDITIONALLY. Empty extra
  // must NOT produce the "## Additional context" header. Without this
  // guard, every dream prompt would have a dangling empty header.

  test('empty extra → no "Additional context" section', () => {
    const result = buildConsolidationPrompt('/m', '/t', '')
    expect(result).not.toContain('Additional context')
  })

  test('non-empty extra → "Additional context" section appended', () => {
    const result = buildConsolidationPrompt(
      '/m',
      '/t',
      'Focus on the auth subsystem.',
    )
    expect(result).toContain('## Additional context')
    expect(result).toContain('Focus on the auth subsystem.')
  })

  test('extra appears AT THE END (after the "summary" instruction)', () => {
    const result = buildConsolidationPrompt('/m', '/t', 'XXX-MARKER')
    const summaryIdx = result.indexOf('Return a brief summary')
    const extraIdx = result.indexOf('XXX-MARKER')
    expect(extraIdx).toBeGreaterThan(summaryIdx)
  })

  test('extra with newlines preserved verbatim', () => {
    const extra = 'line1\nline2\nline3'
    expect(buildConsolidationPrompt('/m', '/t', extra)).toContain(extra)
  })
})

describe('buildConsolidationPrompt — phase structure (contract anchor)', () => {
  // The 4-phase structure is load-bearing: it tells the model how to
  // approach memory consolidation. If a refactor accidentally drops
  // a phase, future dreams would skip critical steps (e.g. dropping
  // Phase 4 means the index never gets pruned).

  test('contains all 4 phases by name', () => {
    const result = buildConsolidationPrompt('/m', '/t', '')
    expect(result).toContain('Phase 1 — Orient')
    expect(result).toContain('Phase 2 — Gather recent signal')
    expect(result).toContain('Phase 3 — Consolidate')
    expect(result).toContain('Phase 4 — Prune and index')
  })

  test('phases appear in correct order', () => {
    const result = buildConsolidationPrompt('/m', '/t', '')
    const p1 = result.indexOf('Phase 1')
    const p2 = result.indexOf('Phase 2')
    const p3 = result.indexOf('Phase 3')
    const p4 = result.indexOf('Phase 4')
    expect(p1).toBeLessThan(p2)
    expect(p2).toBeLessThan(p3)
    expect(p3).toBeLessThan(p4)
  })

  test('mentions the absolute-date-conversion contract', () => {
    // Important for memory durability — relative dates expire silently.
    expect(
      buildConsolidationPrompt('/m', '/t', ''),
    ).toMatch(/absolute dates/i)
  })

  test('warns against creating near-duplicates', () => {
    expect(
      buildConsolidationPrompt('/m', '/t', ''),
    ).toMatch(/duplicates|duplicate/i)
  })

  test('mentions "index" and "not a dump"', () => {
    // Locks the entrypoint-discipline contract: entrypoint is an INDEX,
    // not a content dump. Catches a refactor that softens this language.
    const result = buildConsolidationPrompt('/m', '/t', '')
    expect(result).toContain('index')
    expect(result).toContain('not a dump')
  })

  test('returns a non-empty string', () => {
    const result = buildConsolidationPrompt('/m', '/t', '')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(500)
  })
})
