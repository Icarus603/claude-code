import { describe, expect, test } from 'bun:test'

import {
  MAX_MEMORY_CHARACTER_COUNT,
  POLICY_HELPER_CLAUDE_MD_SENTINEL,
  getLargeMemoryFiles,
  filterInjectedMemoryFiles,
} from '../claudemd.js'

/**
 * Pin user-visible CLAUDE.md / memory constants and the small filter
 * helpers. The bigger functions (getMemoryFiles, processMdRules) are
 * integration-tested elsewhere; these are the constants the rest of the
 * system reads + the predicates that decide what gets shown in /memory.
 */
describe('CLAUDE.md memory constants + filters (vs ant)', () => {
  test('MAX_MEMORY_CHARACTER_COUNT is 40_000 (ant default)', () => {
    expect(MAX_MEMORY_CHARACTER_COUNT).toBe(40_000)
  })

  test('POLICY_HELPER_CLAUDE_MD_SENTINEL is the literal "<policyHelper>" (ant H6H)', () => {
    // ant 0687.js: H6H = "<policyHelper>". The leading `<` ensures
    // downstream path-handling code treats this as a non-file marker
    // (it can't be a valid filesystem path).
    expect(POLICY_HELPER_CLAUDE_MD_SENTINEL).toBe('<policyHelper>')
    expect(POLICY_HELPER_CLAUDE_MD_SENTINEL.startsWith('<')).toBe(true)
  })

  test('getLargeMemoryFiles flags files above MAX_MEMORY_CHARACTER_COUNT', () => {
    const files = [
      { path: 'small.md', content: 'a'.repeat(10_000), type: 'Project' as const },
      { path: 'big.md', content: 'a'.repeat(50_000), type: 'Project' as const },
      { path: 'edge.md', content: 'a'.repeat(40_000), type: 'Project' as const },
    ]
    const large = getLargeMemoryFiles(files)
    // 10K → not large; 50K → large; 40K (== threshold) → NOT large (strict >)
    expect(large.map(f => f.path)).toEqual(['big.md'])
  })

  test('getLargeMemoryFiles strict >, NOT >= (exactly 40K is not flagged)', () => {
    const exactly = [{
      path: 'exact.md',
      content: 'a'.repeat(MAX_MEMORY_CHARACTER_COUNT),
      type: 'Project' as const,
    }]
    expect(getLargeMemoryFiles(exactly)).toEqual([])
    // 40_001 → flagged
    expect(getLargeMemoryFiles([{
      path: 'over.md',
      content: 'a'.repeat(MAX_MEMORY_CHARACTER_COUNT + 1),
      type: 'Project' as const,
    }])).toHaveLength(1)
  })

  test('filterInjectedMemoryFiles is a no-op when tengu_moth_copse flag is false (default)', () => {
    // In bun:test the feature flag stub returns the default `false`.
    // Function returns input untouched, preserving Managed/policyHelper.
    const files = [
      { path: '/real/CLAUDE.md', content: 'real', type: 'Project' as const },
      { path: POLICY_HELPER_CLAUDE_MD_SENTINEL, content: 'managed', type: 'Managed' as const },
    ]
    const filtered = filterInjectedMemoryFiles(files)
    expect(filtered).toEqual(files)
  })
})
