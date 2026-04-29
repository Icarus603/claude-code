import { describe, expect, test } from 'bun:test'
import {
  applyCoordinatorToolFilter,
  isPrActivitySubscriptionTool,
  mergeAndFilterTools,
} from '../filtering.js'

describe('isPrActivitySubscriptionTool', () => {
  // Critical contract: matches PR-activity tools by SUFFIX, not full
  // name. The MCP server prefix (mcp__github__, mcp__custom__, etc.)
  // varies but the suffix is stable. Without suffix matching, a plugin
  // server with a different prefix would not be recognized as a
  // coordinator-eligible PR tool.

  test('subscribe_pr_activity exact name → true', () => {
    expect(isPrActivitySubscriptionTool('subscribe_pr_activity')).toBe(true)
  })

  test('unsubscribe_pr_activity exact name → true', () => {
    expect(isPrActivitySubscriptionTool('unsubscribe_pr_activity')).toBe(true)
  })

  test('mcp prefix + suffix → true (MCP-routed PR tool)', () => {
    expect(
      isPrActivitySubscriptionTool('mcp__github__subscribe_pr_activity'),
    ).toBe(true)
    expect(
      isPrActivitySubscriptionTool('mcp__custom__unsubscribe_pr_activity'),
    ).toBe(true)
  })

  test('any string ending in subscribe_pr_activity matches', () => {
    expect(isPrActivitySubscriptionTool('xyz_subscribe_pr_activity')).toBe(true)
    expect(
      isPrActivitySubscriptionTool('plugin_namespace_subscribe_pr_activity'),
    ).toBe(true)
  })

  test('non-matching tool names → false', () => {
    expect(isPrActivitySubscriptionTool('Bash')).toBe(false)
    expect(isPrActivitySubscriptionTool('subscribe')).toBe(false)
    expect(isPrActivitySubscriptionTool('pr_activity')).toBe(false)
  })

  test('case-sensitive suffix match', () => {
    // SUBSCRIBE_PR_ACTIVITY (uppercase) does NOT match. Lowercase
    // variant only.
    expect(
      isPrActivitySubscriptionTool('mcp__github__SUBSCRIBE_PR_ACTIVITY'),
    ).toBe(false)
  })

  test('does NOT match if suffix is in the MIDDLE of the name', () => {
    // endsWith semantics — suffix must be at end.
    expect(
      isPrActivitySubscriptionTool('subscribe_pr_activity_v2'),
    ).toBe(false)
  })

  test('empty string → false', () => {
    expect(isPrActivitySubscriptionTool('')).toBe(false)
  })
})

describe('applyCoordinatorToolFilter', () => {
  // Filters tools array to coordinator-allowed set + PR activity tools.

  function tool(name: string) {
    return { name, description: '', input_schema: {} } as never
  }

  test('keeps tools in COORDINATOR_MODE_ALLOWED_TOOLS', () => {
    // Need to pick names from the allowlist. SendMessage is one of them.
    const result = applyCoordinatorToolFilter([
      tool('SendMessage'),
      tool('NotInAllowlist'),
    ])
    expect(result.find(t => t.name === 'SendMessage')).toBeDefined()
    expect(result.find(t => t.name === 'NotInAllowlist')).toBeUndefined()
  })

  test('keeps PR-activity subscription tools', () => {
    const result = applyCoordinatorToolFilter([
      tool('mcp__github__subscribe_pr_activity'),
      tool('mcp__github__create_pr'),
    ])
    expect(
      result.find(t => t.name === 'mcp__github__subscribe_pr_activity'),
    ).toBeDefined()
    expect(
      result.find(t => t.name === 'mcp__github__create_pr'),
    ).toBeUndefined()
  })

  test('filters out non-allowed tools', () => {
    const result = applyCoordinatorToolFilter([
      tool('Bash'),
      tool('FileEdit'),
      tool('FileWrite'),
    ])
    // None of these are in the coordinator allowlist (Bash etc are
    // worker tools).
    expect(result).toEqual([])
  })

  test('empty input → empty output', () => {
    expect(applyCoordinatorToolFilter([])).toEqual([])
  })

  test('preserves order of input array', () => {
    // Filter is not a sort — input order is preserved among kept tools.
    const t1 = tool('mcp__github__subscribe_pr_activity')
    const t2 = tool('mcp__github__unsubscribe_pr_activity')
    const result = applyCoordinatorToolFilter([t1, t2])
    expect(result[0]).toBe(t1)
    expect(result[1]).toBe(t2)
  })
})
