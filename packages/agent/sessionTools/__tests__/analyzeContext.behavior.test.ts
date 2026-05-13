import { describe, expect, test } from 'bun:test'

import { TOOL_TOKEN_COUNT_OVERHEAD } from '../analyzeContext.ts'

/**
 * Pin /context tool-token-counting invariants. /context analyzes session
 * state for the user; wrong counting leads to misleading "you've used X%"
 * displays.
 *
 * TOOL_TOKEN_COUNT_OVERHEAD = 500 is the fixed-per-request overhead that
 * the API charges for the tool definitions block as a whole. Without
 * subtracting this from per-tool counts:
 *  - The /context breakdown shows each tool as 500 tokens larger than it is
 *  - Summing per-tool counts gives ~500×N instead of ~500+sum(content)
 *  - User sees inflated "tools take X tokens" and is misled into removing
 *    helpful tools to "free up context"
 */
describe('analyzeContext token-accounting invariants', () => {
  test('TOOL_TOKEN_COUNT_OVERHEAD = 500 (fixed-per-request, not per-tool)', () => {
    expect(TOOL_TOKEN_COUNT_OVERHEAD).toBe(500)
  })

  test('TOOL_TOKEN_COUNT_OVERHEAD is exported (used by other counting paths)', () => {
    // Pin the export surface so other modules can adjust their own
    // per-tool subtraction symmetrically.
    expect(typeof TOOL_TOKEN_COUNT_OVERHEAD).toBe('number')
  })
})
